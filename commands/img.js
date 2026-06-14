"use strict";
const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");
const os    = require("os");

const HF_BASE = (process.env.HF_SPACE_URL || "").replace(/\/+$/, "");

function getTempPath(senderID) {
  return path.join(os.tmpdir(), `img_${Date.now()}_${senderID}.jpg`);
}

// ─── ترجمة وتحسين الـ prompt عبر HF Space ───────────────────
async function enhancePrompt(prompt) {
  try {
    const { data } = await axios.post(
      `${HF_BASE}/groq`,
      {
        messages: [
          {
            role: "system",
            content: `You are an AI image prompt engineer. Your job is:
1. Translate any non-English text to English
2. Enhance the prompt to be vivid, detailed, and optimized for image generation
3. Add artistic style, lighting, and quality keywords
4. Return ONLY the enhanced English prompt, nothing else. No explanations.

Examples:
Input: "قطة لطيفة"
Output: "A cute fluffy cat with bright eyes, soft fur, natural lighting, photorealistic, 8k quality, detailed"

Input: "sunset"
Output: "Golden sunset over mountains, dramatic sky, warm orange and pink hues, cinematic lighting, highly detailed, 4k"`,
          },
          { role: "user", content: prompt },
        ],
      },
      { timeout: 15000, headers: { "Content-Type": "application/json" } }
    );
    return data.reply?.trim() || prompt;
  } catch (_) {
    return prompt; // إذا فشلت الترجمة، استخدم الـ prompt الأصلي
  }
}

async function callImageHF(prompt, model) {
  if (!HF_BASE) throw new Error("HF_SPACE_URL غير مضبوط في متغيرات Render");

  const { data } = await axios.post(
    `${HF_BASE}/image`,
    { prompt, model },
    { timeout: 90000, headers: { "Content-Type": "application/json" } }
  );

  if (data.error) throw new Error(data.error);
  if (!data.image_base64) throw new Error("استجابة فارغة من الخادم");

  return data;
}

const MODELS_INFO = {
  "flux":       { label: "FLUX Schnell ⚡",  desc: "سريع وجودة عالية (افتراضي)" },
  "flux-dev":   { label: "FLUX Dev 🎨",      desc: "أكثر إبداعاً وتفصيلاً" },
  "sdxl":       { label: "SDXL Turbo 🚀",   desc: "سريع جداً" },
  "sd":         { label: "Stable Diffusion", desc: "نموذج كلاسيكي" },
};

const HELP_MSG =
  "🎨 *توليد الصور بالذكاء الاصطناعي*\n" +
  "━━━━━━━━━━━━━━━━━━━━━━\n\n" +
  "📝 *طريقة الاستخدام:*\n" +
  "• img [وصف] — يولد صورة بـ FLUX\n" +
  "• img [نموذج] [وصف] — يختار النموذج\n\n" +
  "🧩 *النماذج المتاحة:*\n" +
  "┌ flux     — FLUX Schnell ⚡ (افتراضي)\n" +
  "├ flux-dev — FLUX Dev 🎨 (أكثر إبداعاً)\n" +
  "├ sdxl     — SDXL Turbo 🚀 (سريع جداً)\n" +
  "└ sd       — Stable Diffusion (كلاسيكي)\n\n" +
  "💡 *أمثلة:*\n" +
  "• img قطة لطيفة في الغابة\n" +
  "• img flux-dev غروب الشمس فوق الجبال\n" +
  "• img sdxl a futuristic city at night\n\n" +
  "✨ يترجم وصفك تلقائياً للإنجليزية ويحسّنه!";

module.exports = {
  config: {
    name: "img",
    aliases: ["صورة", "تخيل", "ارسم", "draw", "imagine", "image", "generate"],
    version: "3.0.0",
    author: "Sunken",
    countDown: 10,
    role: 0,
    shortDescription: { ar: "🎨 توليد صور بالذكاء الاصطناعي" },
    longDescription: { ar: "يولد صوراً من النص بعدة نماذج (FLUX, SDXL...) مع ترجمة تلقائية للإنجليزية وتحسين الـ prompt" },
    category: "وسائط",
    guide: {
      ar:
        "{pn}img [وصف] — توليد بـ FLUX (افتراضي)\n" +
        "{pn}img flux-dev [وصف] — أكثر إبداعاً\n" +
        "{pn}img sdxl [وصف] — أسرع\n\n" +
        "النماذج: flux | flux-dev | sdxl | sd"
    },
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID } = event;

    let promptArgs = [...args];
    let model = "flux";

    const MODEL_NAMES = Object.keys(MODELS_INFO);
    if (promptArgs[0] && MODEL_NAMES.includes(promptArgs[0].toLowerCase())) {
      model = promptArgs.shift().toLowerCase();
    }

    const originalPrompt = promptArgs.join(" ").trim();

    if (!originalPrompt) return message.reply(HELP_MSG);
    if (!HF_BASE) return message.reply("❌ HF_SPACE_URL غير مضبوط في متغيرات Render");

    const modelInfo = MODELS_INFO[model] || MODELS_INFO["flux"];

    // ─── رسالة الحالة ────────────────────────────────────────
    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(
          `🎨 جاري المعالجة...\n🤖 النموذج: ${modelInfo.label}\n📝 الوصف: ${originalPrompt}`,
          threadID, (err, info) => err ? reject(err) : resolve(info), messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    // ─── ترجمة وتحسين الـ prompt ─────────────────────────────
    await updateStatus(`🌐 جاري ترجمة وتحسين الوصف...\n🤖 ${modelInfo.label}`);
    const enhancedPrompt = await enhancePrompt(originalPrompt);
    console.log(`[IMG] original: "${originalPrompt}" → enhanced: "${enhancedPrompt.substring(0, 100)}"`);

    // ─── توليد الصورة ─────────────────────────────────────────
    await updateStatus(`🎨 جاري توليد الصورة...\n🤖 ${modelInfo.label}\n✨ ${enhancedPrompt.substring(0, 80)}...`);

    let data;
    try {
      data = await callImageHF(enhancedPrompt, model);
    } catch (e) {
      console.error("[IMG→HF]", e.response?.status, e.message?.substring(0, 120));
      let msg = "❌ فشل توليد الصورة.\n";
      if (e.code === "ECONNABORTED" || e.message?.includes("timeout"))
        msg += "⏱️ انتهت مهلة الاتصال — جرب وصفاً أقصر أو نموذجاً آخر.";
      else if (e.message?.includes("HF_TOKEN"))
        msg += "🔑 HF_TOKEN غير مضبوط على الخادم.";
      else if (e.message?.includes("deprecated") || e.message?.includes("410"))
        msg += "⚠️ النموذج غير متاح حالياً — جرب: flux أو flux-dev";
      else
        msg += `السبب: ${(e.message || "خطأ غير معروف").substring(0, 150)}`;
      return updateStatus(msg);
    }

    const filePath = getTempPath(event.senderID || "user");

    try {
      const buffer = Buffer.from(data.image_base64, "base64");
      if (buffer.length === 0) throw new Error("الصورة فارغة.");

      await fs.writeFile(filePath, buffer);

      await new Promise((resolve, reject) => {
        api.sendMessage(
          {
            body:
              `✅ تم التوليد!\n` +
              `🤖 النموذج: ${modelInfo.label}\n` +
              `📝 الطلب: ${originalPrompt}\n` +
              `✨ المُحسَّن: ${enhancedPrompt.substring(0, 100)}${enhancedPrompt.length > 100 ? "..." : ""}`,
            attachment: fs.createReadStream(filePath),
          },
          threadID,
          (err) => err ? reject(err) : resolve(),
          messageID
        );
      });

      try { if (statusMsgId) await api.unsendMessage(statusMsgId, threadID); } catch (_) {}

    } catch (e) {
      console.error("[IMG] send error:", e.message);
      await updateStatus(`❌ فشل إرسال الصورة: ${(e.message || "").substring(0, 100)}`);
    } finally {
      try { if (await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
    }
  },
};

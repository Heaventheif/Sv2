"use strict";
const axios    = require("axios");
const mongoose = require("mongoose");

const HF_BASE = process.env.HF_SPACE_URL || "";

// ─── Schema للجلسات ──────────────────────────────────────────
const sessionSchema = new mongoose.Schema({
  _id:      String,
  messages: { type: Array, default: [] },
  model:    { type: String, default: "qwen7" },
  updatedAt:{ type: Date,   default: Date.now },
});
const Session = mongoose.models.HFSession
  || mongoose.model("HFSession", sessionSchema);

async function loadCtx(id) {
  try {
    if (!global.db) return { messages: [], model: "qwen7" };
    const doc = await Session.findById(id).lean();
    return {
      messages: doc?.messages?.slice(-10) || [],
      model:    doc?.model || "qwen7",
    };
  } catch (_) { return { messages: [], model: "qwen7" }; }
}

async function saveCtx(id, messages, model) {
  try {
    if (!global.db) return;
    await Session.findByIdAndUpdate(
      id,
      { messages: messages.slice(-10), model, updatedAt: new Date() },
      { upsert: true }
    );
  } catch (_) {}
}

// ─── تحميل الوسائط وتحويلها base64 ──────────────────────────
async function downloadAsBase64(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const contentType = response.headers["content-type"] || "image/jpeg";
    const base64 = Buffer.from(response.data).toString("base64");
    return { base64, contentType };
  } catch (e) {
    console.warn("[HF] فشل تحميل الوسيط:", e.message?.substring(0, 60));
    return null;
  }
}

// ─── كشف المرفق من event (FCA) ───────────────────────────────
function detectAttachment(event) {
  const sources = [
    ...(event.attachments               || []),
    ...(event.messageReply?.attachments || []),
  ];

  for (const att of sources) {
    if (!att) continue;
    const type = (att.type || att.attachmentType || "").toLowerCase();

    if (["photo","image","sticker","animated_image","share"].includes(type)) {
      const url =
        att.largePreviewUrl || att.previewUrl ||
        att.largePreviewUri || att.previewUri ||
        att.uri || att.url  || att.thumbnailUrl ||
        att.image?.uri;
      if (url) return { kind: "image", url };
    }
    if (type === "audio" || type === "voice_message") {
      const url = att.url || att.audioUrl || att.uri;
      if (url) return { kind: "audio", url };
    }
    if (type === "video" || type === "video_inline") {
      const url = att.url || att.uri || att.previewUrl;
      if (url) return { kind: "video", url };
    }
    if (type === "file" || type === "document") {
      const ext = (att.filename || att.name || "").split(".").pop().toLowerCase();
      const url = att.url || att.uri;
      if (!url) continue;
      if (["jpg","jpeg","png","gif","webp","bmp"].includes(ext))
        return { kind: "image", url };
      if (["mp3","m4a","ogg","wav","flac","aac"].includes(ext))
        return { kind: "audio", url };
      if (["mp4","mov","avi","mkv","webm"].includes(ext))
        return { kind: "video", url };
    }
  }
  return null;
}

// ─── استدعاء HF Space ────────────────────────────────────────
async function callHF(messages, model) {
  if (!HF_BASE) throw new Error("HF_SPACE_URL غير مضبوط في متغيرات Render");

  const { data } = await axios.post(
    `${HF_BASE.replace(/\/+$/, "")}/hf`,
    { messages, model, max_tokens: 512 },
    { timeout: 65000, headers: { "Content-Type": "application/json" } }
  );

  if (data.error) throw new Error(data.error);
  if (!data.reply) throw new Error("استجابة فارغة من الخادم");

  // حذف رسائل التفكير <think>...</think>
  const reply = data.reply.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  return { reply, model_used: data.model_used || model };
}

// ─── المعالج الرئيسي ─────────────────────────────────────────
async function handle(api, event, args, registerReply) {
  const { threadID, messageID, senderID } = event;

  const firstArg = args[0]?.toLowerCase() || "";

  // ─── مسح الذاكرة ─────────────────────────────────────────
  if (["مسح", "clear", "reset"].includes(firstArg)) {
    try { await Session.findByIdAndDelete(senderID); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  // ─── عرض النماذج ─────────────────────────────────────────
  if (["نماذج", "models", "list"].includes(firstArg)) {
    return api.sendMessage(
      `🤖 النماذج المتاحة في HF AI:\n\n` +
      `━━━━━ Qwen ━━━━━\n` +
      `• qwen / qwen72 → Qwen2.5-72B (قوي)\n` +
      `• qwen7 → Qwen2.5-7B ✅ مجاني\n` +
      `• qwen3 → Qwen3-235B (ضخم)\n\n` +
      `━━━━━ Llama ━━━━━\n` +
      `• llama / llama8 → Llama-3.1-8B ✅ مجاني\n` +
      `• llama70 → Llama-3.3-70B\n` +
      `• llama4 → Llama-4-Scout-17B\n\n` +
      `━━━━━ Mistral ━━━━━\n` +
      `• mistral → Mistral-7B ✅ مجاني\n` +
      `• mistral22 → Mistral-Small-22B\n` +
      `• mixtral → Mixtral-8x7B\n\n` +
      `━━━━━ DeepSeek ━━━━━\n` +
      `• deepseek7 → DeepSeek-R1-7B ✅ مجاني\n` +
      `• deepseek → DeepSeek-R1-32B\n\n` +
      `━━━━━ أخرى ━━━━━\n` +
      `• phi / phi4 → Microsoft Phi ✅ مجاني\n` +
      `• gemma / gemma4 → Google Gemma ✅ مجاني\n` +
      `• zephyr → Zephyr-7B ✅ مجاني\n` +
      `• command → Cohere Command-R\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💡 يمكنك أيضاً إرسال معرّف كامل:\n` +
      `.hf Qwen/Qwen2.5-72B-Instruct سؤالك\n\n` +
      `📸 يدعم الصور والوسائط!\n` +
      `🧹 .hf مسح — لمسح الذاكرة`,
      threadID, null, messageID
    );
  }

  // ─── تحديد النموذج والسؤال ───────────────────────────────
  const { messages: savedCtx, model: savedModel } = await loadCtx(senderID);

  let model, promptArgs;

  const looksLikeModel = firstArg &&
    !firstArg.includes(" ") &&
    !/^[\u0600-\u06FF]/.test(firstArg) &&
    (firstArg.includes("/") || firstArg.length <= 15);

  if (looksLikeModel && args.length > 1) {
    model      = args[0];
    promptArgs = args.slice(1);
  } else if (looksLikeModel && args.length === 1) {
    model      = args[0];
    promptArgs = [];
  } else {
    model      = savedModel;
    promptArgs = args;
  }

  let prompt = promptArgs.join(" ").trim();

  if (!prompt && event.messageReply?.body)
    prompt = event.messageReply.body.trim();

  // ─── كشف الوسائط ─────────────────────────────────────────
  const attachment = detectAttachment(event);

  // بدون سؤال ولا وسيط
  if (!prompt && !attachment) {
    return api.sendMessage(
      `🤖 HF AI — النموذج الحالي: ${model}\n\n` +
      `📝 الاستخدام:\n` +
      `.hf [نموذج] [سؤالك]\n\n` +
      `💡 أمثلة:\n` +
      `.hf qwen7 ما هو الذكاء الاصطناعي؟\n` +
      `.hf llama اشرح لي البرمجة\n` +
      `.hf mistral كيف تعمل الشبكات؟\n` +
      `.hf + صورة — تحليل الصورة\n\n` +
      `📋 .hf نماذج — كل النماذج المتاحة\n` +
      `🧹 .hf مسح — مسح الذاكرة`,
      threadID, null, messageID
    );
  }

  if (!HF_BASE) {
    return api.sendMessage("❌ HF_SPACE_URL غير مضبوط في متغيرات Render", threadID, null, messageID);
  }

  // مؤشر انتظار
  api.sendMessage(
    attachment
      ? `⏳ جاري تحليل ${attachment.kind === "image" ? "الصورة 🖼️" : attachment.kind === "audio" ? "الصوت 🎵" : "الفيديو 🎬"} لـ ${model}...`
      : `⏳ جاري السؤال لـ ${model}...`,
    threadID, null, messageID
  );

  // ─── تحضير رسالة المستخدم مع الوسيط ─────────────────────
  let userMsg;

  if (attachment?.kind === "image") {
    const imgData = await downloadAsBase64(attachment.url);
    if (imgData) {
      userMsg = {
        role: "user",
        content: prompt || "وصف هذه الصورة",
        attachment: {
          kind:        "image",
          base64:      imgData.base64,
          contentType: imgData.contentType,
        },
      };
    } else {
      userMsg = { role: "user", content: prompt || "وصف هذه الصورة" };
      api.sendMessage("⚠️ تعذّر تحميل الصورة، سأجيب على النص فقط.", threadID, null, messageID);
    }
  } else if (attachment) {
    userMsg = {
      role: "user",
      content: prompt || (attachment.kind === "audio" ? "فرّغ هذا الصوت" : "حلل هذا الفيديو"),
      attachment: { kind: attachment.kind, url: attachment.url },
    };
  } else {
    userMsg = { role: "user", content: prompt };
  }

  const messages = [...savedCtx, userMsg];

  try {
    const { reply, model_used } = await callHF(messages, model);

    api.sendMessage(reply, threadID, (err, info) => {
      if (err || !info) return;
      if (registerReply) {
        registerReply(info.messageID, { author: senderID }, async ({ api, event }) => {
          await handle(api, event, [model, event.body?.trim() || ""].filter(Boolean), registerReply);
        });
      }
    }, messageID);

    await saveCtx(senderID, [
      ...savedCtx,
      { role: "user",      content: userMsg.content },
      { role: "assistant", content: reply },
    ], model_used);

  } catch (err) {
    let msg = "❌ خطأ: ";
    if (err.code === "ECONNABORTED" || err.message?.includes("timeout"))
      msg += "⏱️ انتهت مهلة الاتصال — جرب نموذجاً أصغر مثل: qwen7 أو mistral";
    else if (err.message?.includes("HF_SPACE_URL"))
      msg += err.message;
    else
      msg += (err.message || "فشل الاتصال").substring(0, 120);

    api.sendMessage(msg, threadID, null, messageID);
  }
}

module.exports = {
  config: {
    name:             "hf",
    aliases:          ["huggingface", "hfai"],
    version:          "3.0.0",
    author:           "Sunken",
    countDown:        5,
    role:             0,
    shortDescription: { ar: "ذكاء اصطناعي — أي نموذج من HuggingFace + دعم الصور" },
    longDescription:  {
      ar:
        "تحدث مع أي نموذج ذكاء اصطناعي من HuggingFace مع دعم الصور والوسائط\n\n" +
        "النماذج المجانية ✅:\n" +
        "• qwen7 — Qwen2.5-7B\n" +
        "• llama / llama8 — Llama-3.1-8B\n" +
        "• mistral — Mistral-7B\n" +
        "• deepseek7 — DeepSeek-R1-7B\n" +
        "• phi / phi4 — Microsoft Phi\n" +
        "• gemma / gemma4 — Google Gemma\n" +
        "• zephyr — Zephyr-7B\n\n" +
        "نماذج أقوى (تحتاج HF PRO):\n" +
        "• qwen / qwen72 — Qwen2.5-72B\n" +
        "• llama70 — Llama-3.3-70B\n" +
        "• llama4 — Llama-4-Scout\n" +
        "• deepseek — DeepSeek-R1-32B\n" +
        "• command — Cohere Command-R\n\n" +
        "أو أرسل معرّف كامل من HF:\n" +
        "Qwen/Qwen2.5-72B-Instruct",
    },
    category: "ذكاء اصطناعي",
    guide: {
      ar:
        "{pn}hf [نموذج] [سؤالك]\n" +
        "{pn}hf qwen7 ما هو الذكاء الاصطناعي؟\n" +
        "{pn}hf llama اشرح البرمجة\n" +
        "{pn}hf + صورة — تحليل الصورة\n" +
        "{pn}hf نماذج — عرض كل النماذج\n" +
        "{pn}hf مسح — مسح الذاكرة",
    },
  },

  onStart: async ({ api, event, args, message }) => {
    await handle(api, event, args, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, [event.body?.trim() || ""], message?.registerReply);
  },
};

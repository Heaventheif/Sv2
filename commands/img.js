"use strict";
const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");
const os    = require("os");

const HF_BASE = (process.env.HF_SPACE_URL || "").replace(/\/+$/, "");

function getTempPath(senderID) {
  return path.join(os.tmpdir(), `img_${Date.now()}_${senderID}.jpg`);
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

module.exports = {
  config: {
    name: "img",
    aliases: ["صورة", "تخيل", "ارسم", "draw", "imagine", "image", "generate"],
    version: "2.0.0",
    author: "Sunken",
    countDown: 10,
    role: 0,
    shortDescription: { ar: "توليد الصور من النص بالذكاء الاصطناعي (HF)" },
    category: "وسائط",
    guide: { ar: "{pn}img [وصف الصورة]\n{pn}img flux-dev/sdxl/sd3 [وصف]" },
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID } = event;

    let promptArgs = [...args];
    let model = "flux";

    const MODEL_NAMES = ["flux", "flux-dev", "sdxl", "sd3", "sd", "playground"];
    if (promptArgs[0] && MODEL_NAMES.includes(promptArgs[0].toLowerCase())) {
      model = promptArgs.shift().toLowerCase();
    }

    const prompt = promptArgs.join(" ").trim();

    if (!prompt) {
      return message.reply(
        "🎨 أمر توليد الصور\n\n" +
        "📝 اكتب وصفاً للصورة:\n" +
        "• img قطة لطيفة\n" +
        "• img sunset over mountains\n\n" +
        "🧩 نماذج إضافية:\n" +
        "img flux-dev/sdxl/sd3 [وصف]"
      );
    }

    if (!HF_BASE) return message.reply("❌ HF_SPACE_URL غير مضبوط في متغيرات Render");

    // ─── رسالة واحدة قابلة للتعديل ────────────────────────────
    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(`🎨 جاري توليد الصورة بـ ${model}...`, threadID, (err, info) => err ? reject(err) : resolve(info), messageID)
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    let data;
    try {
      data = await callImageHF(prompt, model);
    } catch (e) {
      console.error("[IMG→HF]", e.response?.status, e.message?.substring(0, 120));
      let msg = "❌ فشل توليد الصورة.\n";
      if (e.code === "ECONNABORTED" || e.message?.includes("timeout"))
        msg += "⏱️ انتهت مهلة الاتصال — جرب وصفاً أقصر أو نموذجاً آخر.";
      else if (e.message?.includes("HF_TOKEN"))
        msg += "🔑 HF_TOKEN غير مضبوط على الخادم.";
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
            body:       `✅ ${prompt}\n🤖 ${data.model_used || model}`,
            attachment: fs.createReadStream(filePath),
          },
          threadID,
          (err) => err ? reject(err) : resolve(),
          messageID
        );
      });

      if (statusMsgId) {
        try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
      }

    } catch (e) {
      console.error("[IMG] send error:", e.message);
      await updateStatus(`❌ فشل إرسال الصورة: ${(e.message || "").substring(0, 100)}`);
    } finally {
      try { if (await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
    }
  },
};

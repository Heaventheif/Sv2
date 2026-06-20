"use strict";

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const HF_BASE = "https://solvant-s.hf.space";

module.exports = {
  config: {
    name:      "tts",
    aliases:   ["speak", "voice", "صوت"],
    version:   "1.0",
    role:      0,
    countDown: 10,
    category:  "media",
    guide: { en:
      "{pn} <نص>              — تحويل النص لصوت\n" +
      "{pn} voice <اسم> <نص> — اختيار صوت معين\n" +
      "{pn} voices            — عرض الأصوات المتاحة"
    }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "🎙️ تحويل النص إلى صوت\n\n" +
      "• tts <نص>              — تحويل عشوائي\n" +
      "• tts voice <اسم> <نص> — صوت محدد\n" +
      "• tts voices            — قائمة الأصوات"
    );

    // ── عرض الأصوات ─────────────────────────────────────────
    if (args[0].toLowerCase() === "voices") {
      try {
        const res = await axios.get(`${HF_BASE}/tts/voices`, { timeout: 10000 });
        const { voices, total, model } = res.data;
        const list = voices.join("، ");
        return message.reply(`🎙️ الأصوات المتاحة (${total}):\n\n${list}\n\n📌 النموذج: ${model}`);
      } catch (e) {
        return message.reply("❌ فشل جلب قائمة الأصوات.");
      }
    }

    // ── تحديد الصوت والنص ───────────────────────────────────
    let voice = null;
    let text  = null;

    if (args[0].toLowerCase() === "voice") {
      voice = args[1] || null;
      text  = args.slice(2).join(" ").trim();
    } else {
      text = args.join(" ").trim();
    }

    if (!text) return message.reply("❌ أرسل النص المراد تحويله.");

    // ── رسالة انتظار ────────────────────────────────────────
    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(
          "🎙️ جارٍ تحويل النص إلى صوت...",
          threadID,
          (err, info) => err ? reject(err) : resolve(info),
          messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (txt) => {
      try { if (statusMsgId) await api.editMessage(txt, statusMsgId); } catch (_) {}
    };

    // ── استدعاء tts.py ──────────────────────────────────────
    try {
      const body = { text, base64: true };
      if (voice) body.voice = voice;

      const res = await axios.post(`${HF_BASE}/tts`, body, { timeout: 60000 });
      const { audio_base64, voice: usedVoice, content_type } = res.data;

      if (!audio_base64) throw new Error("لم يُرسَل صوت من السيرفر");

      // ── حفظ الملف مؤقتاً ──────────────────────────────────
      const ext      = content_type?.includes("mp3") ? "mp3" : "wav";
      const filePath = path.join(os.tmpdir(), `tts_${Date.now()}.${ext}`);
      await fs.writeFile(filePath, Buffer.from(audio_base64, "base64"));

      // ── إرسال الصوت ───────────────────────────────────────
      await new Promise((resolve, reject) =>
        api.sendMessage(
          {
            body:       `🎙️ الصوت: ${usedVoice}`,
            attachment: fs.createReadStream(filePath)
          },
          threadID,
          (err) => err ? reject(err) : resolve()
        )
      );

      // حذف رسالة الانتظار
      try { if (statusMsgId) await api.unsendMessage(statusMsgId, threadID); } catch (_) {}

      // تنظيف
      try { await fs.remove(filePath); } catch (_) {}

    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      await updateStatus(`❌ ${msg}`);
    }
  }
};

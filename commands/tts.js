"use strict";
/**
 * sc_tts.js — أمر TTS (تحويل النص إلى صوت)
 * ════════════════════════════════════════════════════
 * يرسل النص لـ HF Space (plugin /tts) ويستقبل ملف mp3
 * ويرسله للمستخدم مباشرة.
 *
 * الاعتماديات: axios, fs-extra (موجودتان في package.json)
 * متغيرات البيئة المطلوبة في Render:
 *   HF_SPACE_URL=https://your-username-your-space.hf.space
 * ════════════════════════════════════════════════════
 */

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

// ─── رابط HF Space ───────────────────────────────────────────
const HF_URL = (process.env.HF_SPACE_URL || "").replace(/\/$/, "");

// ─── حد أقصى للنص ────────────────────────────────────────────
const MAX_TEXT = 3000;

// ─── تنظيف /tmp ──────────────────────────────────────────────
async function cleanTemp(p) {
  try { if (p && await fs.pathExists(p)) await fs.remove(p); } catch (_) {}
}

// ─── استدعاء HF Space /tts ───────────────────────────────────
async function fetchTTS(text, voice = null) {
  if (!HF_URL) throw new Error("HF_SPACE_URL غير موجود في متغيرات البيئة");

  const body = { text, base64: false };
  if (voice) body.voice = voice;

  const response = await axios.post(`${HF_URL}/tts`, body, {
    responseType: "arraybuffer",
    timeout:      60000,
    headers: { "Content-Type": "application/json" },
  });

  // استخرج اسم الصوت من headers إن وُجد
  const voiceUsed = response.headers["x-voice-used"] || voice || "unknown";

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error("ملف الصوت فارغ");

  return { buffer, voiceUsed };
}

// ════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:      "tts",
    aliases:   ["صوت", "نطق", "speak"],
    version:   "1.0",
    role:      0,
    countDown: 10,
    category:  "media",
    guide: {
      en:
        "{pn} <النص>             — يحوّل النص إلى صوت\n" +
        "{pn} -v Aoede <النص>    — يختار صوتاً محدداً\n" +
        "{pn} voices             — يعرض قائمة الأصوات",
    },
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    // ─── بدون args ────────────────────────────────────────
    if (!args[0]) {
      return message.reply(
        "🔊 تحويل النص إلى صوت (Gemini TTS)\n\n" +
        "الاستخدام:\n" +
        ".tts <النص>\n" +
        ".tts -v Aoede <النص>   (صوت محدد)\n" +
        ".tts voices             (قائمة الأصوات)\n\n" +
        "مثال:\n" +
        ".tts مرحباً، كيف حالك؟"
      );
    }

    // ─── عرض قائمة الأصوات ────────────────────────────────
    if (args[0].toLowerCase() === "voices") {
      if (!HF_URL) return message.reply("❌ HF_SPACE_URL غير موجود في الإعدادات");
      try {
        const r = await axios.get(`${HF_URL}/tts/voices`, { timeout: 10000 });
        const voices = r.data.voices || [];
        return message.reply(
          `🎙️ الأصوات المدعومة (${voices.length}):\n\n` +
          voices.join(" • ")
        );
      } catch (e) {
        return message.reply(`❌ فشل جلب قائمة الأصوات: ${e.message?.substring(0, 100)}`);
      }
    }

    // ─── استخراج الصوت المحدد -v <name> ──────────────────
    let voice = null;
    let textArgs = [...args];
    if (args[0] === "-v" && args[1]) {
      voice    = args[1];
      textArgs = args.slice(2);
    }

    const text = textArgs.join(" ").trim();
    if (!text) return message.reply("❌ النص فارغ");

    if (text.length > MAX_TEXT) {
      return message.reply(
        `❌ النص طويل جداً (${text.length} حرف)\n` +
        `الحد الأقصى: ${MAX_TEXT} حرف`
      );
    }

    // ─── رسالة الحالة ─────────────────────────────────────
    let statusMsgId = null;
    try {
      const sent = await new Promise((res, rej) =>
        api.sendMessage(
          `🔊 جارٍ تحويل النص إلى صوت...`,
          threadID,
          (err, info) => err ? rej(err) : res(info),
          messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const update = async (t) => {
      try { if (statusMsgId) await api.editMessage(t, statusMsgId); } catch (_) {}
    };

    let filePath = null;
    try {
      const { buffer, voiceUsed } = await fetchTTS(text, voice);

      // حفظ في /tmp
      filePath = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
      await fs.writeFile(filePath, buffer);

      const stat = await fs.stat(filePath);
      if (stat.size === 0) throw new Error("ملف الصوت فارغ");

      const preview = text.length > 60 ? text.substring(0, 60) + "..." : text;

      await new Promise((res, rej) =>
        api.sendMessage(
          {
            body:       `🎙️ ${voiceUsed}\n📝 ${preview}`,
            attachment: fs.createReadStream(filePath),
          },
          threadID,
          err => err ? rej(err) : res()
        )
      );

      try { if (statusMsgId) api.unsendMessage(statusMsgId, () => {}); } catch (_) {}

    } catch (err) {
      console.error("[tts] خطأ:", err.message);
      await update(`❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`);
    } finally {
      await cleanTemp(filePath);
    }
  },
};

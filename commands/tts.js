"use strict";

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

// ─── Gemini TTS مباشرة من Node ─────────────────────────────────
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(k => k && k.length > 10);

const TTS_MODEL = "gemini-2.5-flash-preview-tts";

const ALL_VOICES = [
  "Aoede", "Autonoe", "Puck", "Fenrir", "Algieba", "Despina", "Gacrux",
  "Zephyr", "Callirrhoe", "Charon", "Rasalgethi", "Iapetus", "Erinome",
  "Schedar", "Sulafat", "Vindemiatrix", "Achird", "Leda", "Sadaltager",
  "Adhil", "Alkaid", "Ankaa", "Arneb", "Baten", "Capella", "Castor",
  "Deneb", "Kraz", "Mizar", "Pollux",
];

// ── تدوير عشوائي بدون تكرار ─────────────────────────────────────
let _voicePool = [];
function nextVoice() {
  if (!_voicePool.length) {
    _voicePool = [...ALL_VOICES].sort(() => Math.random() - 0.5);
  }
  return _voicePool.pop();
}

// ═══════════════════════════════════════════════════════════════
// استدعاء Gemini TTS API مباشرة
// ═══════════════════════════════════════════════════════════════
async function callGeminiTTS(text, voice) {
  if (!GEMINI_KEYS.length) throw new Error("لا توجد مفاتيح GEMINI_API_KEY في البيئة");

  const errors = [];
  for (const key of GEMINI_KEYS) {
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${key}`,
        {
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice }
              }
            }
          }
        },
        { timeout: 60000 }
      );

      const audioData = res.data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) return Buffer.from(audioData, "base64");

      errors.push(`key[${key.slice(0,8)}]: استجابة فارغة`);
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      errors.push(`key[${key.slice(0,8)}]: ${msg}`);
      // تجاوز خطأ الحصة فقط
      const status = e.response?.status;
      if (status !== 429 && status !== 503) throw new Error(msg);
    }
  }
  throw new Error("كل المفاتيح فشلت:\n" + errors.join("\n"));
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:      "tts",
    aliases:   ["speak", "voice", "صوت"],
    version:   "2.0",
    role:      0,
    countDown: 10,
    category:  "media",
    guide: { en:
      "{pn} <نص>               — تحويل النص لصوت عشوائي\n" +
      "{pn} voice <اسم> <نص>  — اختيار صوت معين\n" +
      "{pn} voices             — عرض الأصوات المتاحة"
    }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "🎙️ تحويل النص إلى صوت (Gemini TTS)\n\n" +
      "• tts <نص>              — صوت عشوائي\n" +
      "• tts voice <اسم> <نص> — صوت محدد\n" +
      "• tts voices            — قائمة الأصوات الـ 30"
    );

    // ── عرض الأصوات ──────────────────────────────────────────
    if (args[0].toLowerCase() === "voices") {
      return message.reply(
        `🎙️ الأصوات المتاحة (${ALL_VOICES.length}):\n\n` +
        ALL_VOICES.join("، ") +
        `\n\n📌 النموذج: ${TTS_MODEL}`
      );
    }

    // ── تحديد الصوت والنص ────────────────────────────────────
    let voice, text;
    if (args[0].toLowerCase() === "voice") {
      voice = args[1] || nextVoice();
      text  = args.slice(2).join(" ").trim();
      if (!ALL_VOICES.includes(voice)) {
        voice = nextVoice();
      }
    } else {
      voice = nextVoice();
      text  = args.join(" ").trim();
    }

    if (!text)           return message.reply("❌ أرسل النص المراد تحويله.");
    if (text.length > 3000) return message.reply("❌ النص طويل جداً (3000 حرف كحد أقصى).");

    // ── رسالة انتظار ─────────────────────────────────────────
    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(
          `🎙️ جارٍ تحويل النص بصوت ${voice}...`,
          threadID,
          (err, info) => err ? reject(err) : resolve(info),
          messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (t) => {
      try { if (statusMsgId) await api.editMessage(t, statusMsgId); } catch (_) {}
    };

    // ── استدعاء TTS ──────────────────────────────────────────
    try {
      const audioBuffer = await callGeminiTTS(text, voice);

      const filePath = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
      await fs.writeFile(filePath, audioBuffer);

      await new Promise((resolve, reject) =>
        api.sendMessage(
          {
            body:       `🎙️ الصوت: ${voice}`,
            attachment: fs.createReadStream(filePath),
          },
          threadID,
          err => err ? reject(err) : resolve()
        )
      );

      try { if (statusMsgId) await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
      try { await fs.remove(filePath); } catch (_) {}

    } catch (e) {
      await updateStatus(`❌ ${e.message}`);
    }
  }
};

"use strict";

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const HF = `http://localhost:${process.env.PORT || 10000}`;

// ─── ستيكرز الرقص ────────────────────────────────────────────
const STICKERS_DIR  = path.join(__dirname, "..", "assets", "dance_stickers");
const SUPPORTED_EXT = new Set([".gif", ".png", ".webp"]);
let _stickerCache   = null;

function getStickerFiles() {
  if (_stickerCache) return _stickerCache;
  try {
    const files = fs.readdirSync(STICKERS_DIR)
      .filter(f => SUPPORTED_EXT.has(path.extname(f).toLowerCase()))
      .map(f => path.join(STICKERS_DIR, f));
    _stickerCache = files.length ? files : [];
    return _stickerCache;
  } catch (_) { return []; }
}

async function sendDanceSticker(api, threadID) {
  const files = getStickerFiles();
  if (!files.length) return;
  const chosen = files[Math.floor(Math.random() * files.length)];
  try {
    await new Promise((res, rej) =>
      api.sendMessage(
        { attachment: fs.createReadStream(chosen) },
        threadID,
        err => err ? rej(err) : res()
      )
    );
  } catch (_) {}
}

// ─── استدعاء HF: جلب الـ preview ─────────────────────────────
async function fetchPreview(scUrl) {
  const { data } = await axios.post(
    `${HF}/sc/preview`,
    { url: scUrl },
    { timeout: 60000, headers: { "Content-Type": "application/json" } }
  );

  if (data.error) throw new Error(data.error);
  if (!data.audio_b64) throw new Error("لم يُرجع الـ API بيانات صوت");

  return data; // { title, artist, duration_ms, format, audio_b64, size }
}

// ─── حفظ base64 → ملف مؤقت ───────────────────────────────────
async function saveToTemp(audio_b64, fmt) {
  const filePath = path.join(os.tmpdir(), `scprev_${Date.now()}.${fmt}`);
  await fs.writeFile(filePath, Buffer.from(audio_b64, "base64"));
  return filePath;
}

async function cleanTemp(p) {
  try { if (p && await fs.pathExists(p)) await fs.remove(p); } catch (_) {}
}

// ─── فورمات المدة ────────────────────────────────────────────
function fmtDuration(ms) {
  if (!ms) return "";
  const s  = Math.round(ms / 1000);
  const m  = Math.floor(s / 60);
  const ss = s % 60;
  return `⏱ ${m}:${String(ss).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:      "scprev",
    aliases:   ["preview", "بريفيو", "مقطع"],
    version:   "1.0",
    role:      0,
    countDown: 10,
    category:  "media",
    guide: { en:
      "{pn} <رابط SoundCloud>  —  يجلب مقطع الـ 30 ثانية من الأغنية"
    }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "🎵 جلب مقطع Preview من SoundCloud\n\n" +
      "الاستخدام:\n" +
      ".scprev <رابط soundcloud.com/...>\n\n" +
      "مثال:\n" +
      ".scprev https://soundcloud.com/drake/god-s-plan"
    );

    const scUrl = args[0].trim();

    if (!scUrl.includes("soundcloud.com")) {
      return message.reply("❌ أرسل رابطاً من soundcloud.com");
    }

    // رسالة انتظار
    let statusMsgId = null;
    try {
      const sent = await new Promise((res, rej) =>
        api.sendMessage(
          "🎵 جارٍ جلب المقطع من SoundCloud...",
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
      const preview = await fetchPreview(scUrl);
      filePath = await saveToTemp(preview.audio_b64, preview.format);

      const body =
        `🎵 ${preview.title}` +
        `${preview.artist ? `\n👤 ${preview.artist}` : ""}` +
        `${preview.duration_ms ? `\n${fmtDuration(preview.duration_ms)}` : ""}` +
        `\n🔊 مقطع Preview`;

      await new Promise((res, rej) =>
        api.sendMessage(
          { body, attachment: fs.createReadStream(filePath) },
          threadID,
          err => err ? rej(err) : res()
        )
      );

      // حذف رسالة الانتظار
      try { if (statusMsgId) api.unsendMessage(statusMsgId, () => {}); } catch (_) {}

      // ستيكر رقص
      await sendDanceSticker(api, threadID);

    } catch (err) {
      await update(`❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`);
    } finally {
      await cleanTemp(filePath);
    }
  },
};

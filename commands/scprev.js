"use strict";

const axios      = require("axios");
const fs         = require("fs-extra");
const os         = require("os");
const path       = require("path");
const { Soundcloud } = require("soundcloud.ts");

const HF = `http://localhost:${process.env.PORT || 10000}`;

// ─── soundcloud.ts client (يُهيَّأ مرة واحدة) ────────────────
let _sc = null;
async function getSC() {
  if (!_sc) _sc = await Soundcloud();
  return _sc;
}

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
      api.sendMessage({ attachment: fs.createReadStream(chosen) }, threadID,
        err => err ? rej(err) : res())
    );
  } catch (_) {}
}

// ─── بحث + جلب أول رابط track ────────────────────────────────
async function searchTrack(query) {
  const sc      = await getSC();
  const results = await sc.tracks.search({ q: query, limit: 5 });
  const tracks  = results?.collection || [];

  if (!tracks.length) throw new Error("لم تُوجد نتائج على SoundCloud");

  const track = tracks[0];
  return {
    url:    track.permalink_url,
    title:  track.title,
    artist: track.user?.username || "",
  };
}

// ─── إرسال الرابط لـ HF وجلب الـ preview ────────────────────
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

async function saveToTemp(audio_b64, fmt) {
  const filePath = path.join(os.tmpdir(), `scprev_${Date.now()}.${fmt}`);
  await fs.writeFile(filePath, Buffer.from(audio_b64, "base64"));
  return filePath;
}

async function cleanTemp(p) {
  try { if (p && await fs.pathExists(p)) await fs.remove(p); } catch (_) {}
}

function fmtDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return `⏱ ${m}:${String(s % 60).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:      "scprev",
    aliases:   ["preview", "بريفيو", "مقطع"],
    version:   "2.0",
    role:      0,
    countDown: 10,
    category:  "media",
    guide: { en: "{pn} <اسم الأغنية>  —  مقطع preview 30 ثانية من SoundCloud" }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "🎵 مقطع Preview من SoundCloud\n\n" +
      "الاستخدام:\n" +
      ".scprev <اسم الأغنية>\n\n" +
      "مثال:\n" +
      ".scprev after the dark"
    );

    const query = args.join(" ").trim();

    // رسالة انتظار
    let statusMsgId = null;
    try {
      const sent = await new Promise((res, rej) =>
        api.sendMessage(
          `🔍 جارٍ البحث عن "${query}" في SoundCloud...`,
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
      // 1. بحث عن الأغنية
      const track = await searchTrack(query);
      await update(`🎵 وجدت: ${track.title}\n⏳ جارٍ جلب المقطع...`);

      // 2. إرسال الرابط لـ HF لجلب الـ preview
      const preview = await fetchPreview(track.url);

      // 3. حفظ الملف
      filePath = await saveToTemp(preview.audio_b64, preview.format);

      const body =
        `🎵 ${preview.title || track.title}` +
        `${(preview.artist || track.artist) ? `\n👤 ${preview.artist || track.artist}` : ""}` +
        `${preview.duration_ms ? `\n${fmtDuration(preview.duration_ms)}` : ""}` +
        `\n🔊 مقطع Preview`;

      // 4. إرسال الملف
      await new Promise((res, rej) =>
        api.sendMessage(
          { body, attachment: fs.createReadStream(filePath) },
          threadID,
          err => err ? rej(err) : res()
        )
      );

      // 5. حذف رسالة الانتظار + ستيكر
      try { if (statusMsgId) api.unsendMessage(statusMsgId, () => {}); } catch (_) {}
      await sendDanceSticker(api, threadID);

    } catch (err) {
      await update(`❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`);
    } finally {
      await cleanTemp(filePath);
    }
  },
};

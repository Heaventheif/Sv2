"use strict";
/**
 * sc.js — مقطع Preview من SoundCloud
 * ════════════════════════════════════════════════════
 * بدون play-dl — يعمل على Render مباشرة:
 *
 *   1. استخراج client_id من سكريبتات SoundCloud (مع cache 6 ساعات)
 *   2. بحث عبر api-v2.soundcloud.com/search/tracks
 *   3. استخراج أول transcoding (snipped أو عادي)
 *   4. تحويله → رابط stream مباشر
 *   5. تحميل الملف → /tmp → إرسال للمستخدم
 *
 * الاعتماديات: axios, fs-extra فقط
 * ════════════════════════════════════════════════════
 */

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

// ─── Headers تُقلّد المتصفح ───────────────────────────────────
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// ══════════════════════════════════════════════════════════════
// 1. استخراج client_id مع cache
// ══════════════════════════════════════════════════════════════
let _clientId  = null;
let _clientExp = 0;

async function getClientId() {
  if (_clientId && Date.now() < _clientExp) return _clientId;

  const page = await axios.get("https://soundcloud.com", {
    headers: BROWSER_HEADERS,
    timeout: 15000,
  });

  const scriptUrls = [
    ...page.data.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g),
  ].map(m => m[0]);

  if (!scriptUrls.length) throw new Error("لم تُوجد سكريبتات SoundCloud");

  for (const url of scriptUrls.slice(-5)) {
    try {
      const script = await axios.get(url, {
        headers: BROWSER_HEADERS,
        timeout: 10000,
      });
      const match = script.data.match(/client_id:"([a-zA-Z0-9]{20,32})"/);
      if (match) {
        _clientId  = match[1];
        _clientExp = Date.now() + 6 * 60 * 60 * 1000;
        console.log(`[sc] ✅ client_id: ${_clientId.substring(0, 8)}...`);
        return _clientId;
      }
    } catch (_) {}
  }

  throw new Error("فشل استخراج client_id من SoundCloud");
}

// ══════════════════════════════════════════════════════════════
// 2. بحث + استخراج transcoding + تحميل
// ══════════════════════════════════════════════════════════════
async function searchAndStream(query) {
  const client_id = await getClientId();

  // ─── بحث ──────────────────────────────────────────────────
  const searchRes = await axios.get("https://api-v2.soundcloud.com/search/tracks", {
    params: {
      q:                   query,
      client_id,
      limit:               5,
      offset:              0,
      linked_partitioning: 1,
      app_version:         "1733219585",
      app_locale:          "en",
    },
    headers: BROWSER_HEADERS,
    timeout: 15000,
  });

  const tracks = searchRes.data?.collection;
  if (!tracks?.length) throw new Error("لم تُوجد نتائج على SoundCloud");

  // ─── اختيار أفضل transcoding ──────────────────────────────
  let chosenTrack       = null;
  let chosenTranscoding = null;

  for (const track of tracks) {
    const transcodings = track.media?.transcodings ?? [];
    if (!transcodings.length) continue;

    // أولوية: snipped progressive → snipped hls → أي progressive → أي hls
    const pick =
      transcodings.find(t => t.snipped && t.format?.protocol === "progressive") ||
      transcodings.find(t => t.snipped && t.format?.protocol === "hls")         ||
      transcodings.find(t => t.format?.protocol === "progressive")               ||
      transcodings.find(t => t.format?.protocol === "hls")                       ||
      transcodings[0];

    if (pick) {
      chosenTrack       = track;
      chosenTranscoding = pick;
      break;
    }
  }

  if (!chosenTrack) throw new Error("لم تُوجد نتائج صالحة على SoundCloud");

  // ─── تحويل transcoding URL → stream URL ───────────────────
  const streamRes = await axios.get(chosenTranscoding.url, {
    params: {
      client_id,
      track_authorization: chosenTrack.track_authorization ?? "",
    },
    headers: BROWSER_HEADERS,
    timeout: 15000,
  });

  const streamUrl = streamRes.data?.url;
  if (!streamUrl) throw new Error("فشل استخراج رابط البث");

  // ─── تحميل الملف الصوتي ───────────────────────────────────
  const filePath = path.join(os.tmpdir(), `sc_${Date.now()}.mp3`);

  const dlRes = await axios.get(streamUrl, {
    responseType:      "arraybuffer",
    headers:           BROWSER_HEADERS,
    timeout:           60000,
    maxContentLength:  15 * 1024 * 1024, // 15MB حد أقصى
  });

  const buffer = Buffer.from(dlRes.data);
  if (!buffer.length) throw new Error("ملف الصوت فارغ");

  await fs.writeFile(filePath, buffer);

  const stat = await fs.stat(filePath);
  if (stat.size === 0) throw new Error("ملف الصوت فارغ بعد الحفظ");

  return {
    filePath,
    title:      chosenTrack.title || "بدون عنوان",
    artist:     chosenTrack.publisher_metadata?.artist ||
                chosenTrack.user?.username             || "",
    durationMs: chosenTrack.full_duration || chosenTrack.duration || 0,
    isSnipped:  !!chosenTranscoding.snipped,
  };
}

// ══════════════════════════════════════════════════════════════
// ستيكرز الرقص
// ══════════════════════════════════════════════════════════════
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
  } catch (_) { _stickerCache = []; }
  return _stickerCache;
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

// ══════════════════════════════════════════════════════════════
// مساعدات
// ══════════════════════════════════════════════════════════════
function fmtDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return `⏱ ${m}:${String(s % 60).padStart(2, "0")}`;
}

async function cleanTemp(p) {
  try { if (p && await fs.pathExists(p)) await fs.remove(p); } catch (_) {}
}

// ══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:      "sc",
    aliases:   ["sc", "بريفيو", "مقطع"],
    version:   "4.0",
    role:      0,
    countDown: 10,
    category:  "media",
    guide: { en: "{pn} <اسم الأغنية>  —  مقطع Preview من SoundCloud" },
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "🎵 مقطع Preview من SoundCloud\n\n" +
      "الاستخدام:\n" +
      ".s <اسم الأغنية>\n\n" +
      "مثال:\n" +
      ".s after the dark mr kitty"
    );

    const query = args.join(" ").trim();

    // ─── رسالة الحالة ─────────────────────────────────────────
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

    const update = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    let filePath = null;
    try {
      await update("🎵 جارٍ تجهيز المقطع...");

      const result = await searchAndStream(query);
      filePath = result.filePath;

      const body =
        `🎵 ${result.title}` +
        `${result.artist      ? `\n👤 ${result.artist}`              : ""}` +
        `${result.durationMs  ? `\n${fmtDuration(result.durationMs)}` : ""}` +
        `\n🔊 ${result.isSnipped ? "مقطع Preview 30ث" : "بث كامل"} — SoundCloud`;

      await new Promise((res, rej) =>
        api.sendMessage(
          { body, attachment: fs.createReadStream(filePath) },
          threadID,
          err => err ? rej(err) : res()
        )
      );

      try { if (statusMsgId) api.unsendMessage(statusMsgId, () => {}); } catch (_) {}
      await sendDanceSticker(api, threadID);

    } catch (err) {
      console.error("[sc] خطأ:", err.message);
      await update(`❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`);
    } finally {
      await cleanTemp(filePath);
    }
  },
};

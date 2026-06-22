"use strict";

const play = require("play-dl");
const axios = require("axios");
const fs   = require("fs-extra");
const os   = require("os");
const path = require("path");

let _initialized = false;
async function ensureInit() {
  if (_initialized) return;
  try {
    const clientID = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientID } });
  } catch {
    await play.setToken({ soundcloud: { client_id: "auto" } });
  }
  _initialized = true;
}

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

async function searchAndDownload(query) {
  await ensureInit();

  // 1. بحث
  const results = await play.search(query, {
    source: { soundcloud: "tracks" },
    limit: 1,
  });
  if (!results?.length) throw new Error("لم تُوجد نتائج على SoundCloud");

  const track = results[0];

  // 2. جيب الـ stream object للحصول على معلومات فقط
  const streamData = await play.stream(track.url, { quality: 0 });

  // 3. استخرج الـ URL المباشر من الـ stream
  //    play-dl يضع الـ URL في streamData.url أو في stream._readableState.url
  let directUrl = streamData.url
    || streamData.stream?.url
    || streamData.stream?._readableState?.url;

  if (!directUrl) {
    // طريقة بديلة: نستخدم الـ stream مباشرة عبر pipe مع timeout
    const filePath = path.join(os.tmpdir(), `sc2_${Date.now()}.mp3`);
    await new Promise((res, rej) => {
      const timeout = setTimeout(() => {
        try { streamData.stream.destroy(); } catch(_){}
        rej(new Error("انتهت مهلة التحميل"));
      }, 30000);

      const out = fs.createWriteStream(filePath);
      streamData.stream.pipe(out);
      out.on("finish", () => { clearTimeout(timeout); res(); });
      out.on("error",  (e) => { clearTimeout(timeout); rej(e); });
      streamData.stream.on("error", (e) => { clearTimeout(timeout); rej(e); });
    });

    const stat = await fs.stat(filePath);
    if (stat.size < 1000) throw new Error("الملف فارغ أو ناقص");

    return {
      filePath,
      title:      track.name || "بدون عنوان",
      artist:     track.publisher_metadata?.artist || track.user?.username || "",
      durationMs: (track.durationInSec || 0) * 1000,
    };
  }

  // 4. حمّل بـ axios (أكثر موثوقية من pipe)
  const filePath = path.join(os.tmpdir(), `sc2_${Date.now()}.mp3`);

  const dlRes = await axios.get(directUrl, {
    responseType:     "arraybuffer",
    timeout:          60000,
    maxContentLength: 15 * 1024 * 1024,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  const buffer = Buffer.from(dlRes.data);
  if (!buffer.length) throw new Error("ملف الصوت فارغ");
  await fs.writeFile(filePath, buffer);

  const stat = await fs.stat(filePath);
  if (stat.size < 1000) throw new Error("ملف الصوت ناقص");

  return {
    filePath,
    title:      track.name || "بدون عنوان",
    artist:     track.publisher_metadata?.artist || track.user?.username || "",
    durationMs: (track.durationInSec || 0) * 1000,
  };
}

function fmtDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return `⏱ ${m}:${String(s % 60).padStart(2, "0")}`;
}

async function cleanTemp(p) {
  try { if (p && await fs.pathExists(p)) await fs.remove(p); } catch (_) {}
}

module.exports = {
  config: {
    name:        "sc2",
    aliases:     ["بريفيو2"],
    version:     "3.3",
    role:        0,
    countDown:   10,
    category:    "media",
    description: "تحميل مقطع Preview من SoundCloud عبر مكتبة play-dl — بديل احتياطي لأمر sc",
    guide: { en: "{pn} <اسم الأغنية>  —  مقطع preview من SoundCloud عبر play-dl" }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "🎵 مقطع Preview من SoundCloud (play-dl)\n\n" +
      "الاستخدام:\n" +
      ".sc2 <اسم الأغنية>\n\n" +
      "مثال:\n" +
      ".sc2 after the dark mr kitty"
    );

    const query = args.join(" ").trim();

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
      await update("🎵 جارٍ تحميل المقطع...");

      const result = await searchAndDownload(query);
      filePath = result.filePath;

      const body =
        `🎵 ${result.title}` +
        `${result.artist     ? `\n👤 ${result.artist}`               : ""}` +
        `${result.durationMs ? `\n${fmtDuration(result.durationMs)}` : ""}` +
        `\n🔊 مقطع Preview — SoundCloud`;

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
      console.error("[sc2] خطأ:", err.message);
      await update(`❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`);
    } finally {
      await cleanTemp(filePath);
    }
  },
};

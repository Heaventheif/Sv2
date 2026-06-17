"use strict";

const play = require("play-dl");
const fs   = require("fs-extra");
const os   = require("os");
const path = require("path");

let _initialized = false;
async function ensureInit() {
  if (_initialized) return;
  try {
    // الطريقة الصحيحة للحصول على client_id مجاناً
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

async function searchAndStream(query) {
  await ensureInit();

  const results = await play.search(query, {
    source: { soundcloud: "tracks" },
    limit: 1,
  });

  if (!results?.length) throw new Error("لم تُوجد نتائج على SoundCloud");

  const track = results[0];
  const streamData = await play.stream(track.url, { quality: 0 });

  const filePath = path.join(os.tmpdir(), `scprev_${Date.now()}.mp3`);

  await new Promise((res, rej) => {
    const out    = fs.createWriteStream(filePath);
    const source = streamData.stream;
    source.pipe(out);
    out.on("finish", res);
    out.on("error",  rej);
    source.on("error", rej);
  });

  const stat = await fs.stat(filePath);
  if (stat.size === 0) throw new Error("الملف فارغ");

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
    name:      "sc2",
    aliases:   ["بريفيو2"],   // ← أزلنا "مقطع" لأنه موجود في sc.js
    version:   "3.2",
    role:      0,
    countDown: 10,
    category:  "media",
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

      const result = await searchAndStream(query);
      filePath = result.filePath;

      const body =
        `🎵 ${result.title}` +
        `${result.artist     ? `\n👤 ${result.artist}`            : ""}` +
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
      await update(`❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`);
    } finally {
      await cleanTemp(filePath);
    }
  },
};

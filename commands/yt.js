"use strict";

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

// ─── HuggingFace backend (yt.py) ───────────────────────────────
const HF_BASE = "https://solvant-s.hf.space";

// ─── 7 أزواج إيموجي ────────────────────────────────────────────
const EMOJI_PAIRS = [
  ["👍", "❤️"], ["😆", "😮"], ["😢", "😡"],
  ["🥰", "👏"], ["🔥", "💯"], ["😍", "😭"], ["🤔", "👀"],
];

// ═══════════════════════════════════════════════════════════════
// 🕺 ستيكرز الرقص
// ═══════════════════════════════════════════════════════════════
const STICKERS_DIR = path.join(__dirname, "..", "assets", "dance_stickers");
const SUPPORTED_EXT = new Set([".gif", ".png", ".webp"]);
let _stickerCache = null;

function getStickerFiles() {
  if (_stickerCache) return _stickerCache;
  try {
    const files = fs.readdirSync(STICKERS_DIR)
      .filter(f => SUPPORTED_EXT.has(path.extname(f).toLowerCase()))
      .map(f => path.join(STICKERS_DIR, f));
    if (!files.length) { console.warn("[YT/STICKER] ⚠️ مجلد الستيكرز فارغ"); return []; }
    _stickerCache = files;
    console.log(`[YT/STICKER] ✅ ${files.length} ستيكر جاهز`);
    return files;
  } catch (_) {
    console.warn("[YT/STICKER] ⚠️ المجلد غير موجود");
    return [];
  }
}

async function sendDanceSticker(api, threadID) {
  const files = getStickerFiles();
  if (!files.length) return;
  const chosen = files[Math.floor(Math.random() * files.length)];
  try {
    await new Promise((resolve, reject) =>
      api.sendMessage({ attachment: fs.createReadStream(chosen) }, threadID,
        err => err ? reject(err) : resolve())
    );
  } catch (err) {
    console.error("[YT/STICKER] فشل إرسال الستيكر:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// البحث عبر yt.py على HuggingFace
// ═══════════════════════════════════════════════════════════════
async function hfSearch(query, limit = 7) {
  const res = await axios.post(`${HF_BASE}/yt/search`,
    { query, limit },
    { timeout: 30000 }
  );
  return res.data?.results || [];
}

// ═══════════════════════════════════════════════════════════════
// التحميل عبر yt.py — يرجع base64 ثم نحوّله لملف
// ═══════════════════════════════════════════════════════════════
async function hfDownload(query, type = "mp3") {
  const res = await axios.post(`${HF_BASE}/yt/download`,
    { query, type },
    { timeout: 180000 }   // 3 دقائق — yt.py يفعل retry داخلياً
  );
  const { file_b64, title, author, ext } = res.data;
  if (!file_b64) throw new Error("لم يُرسَل ملف من السيرفر");

  const buffer   = Buffer.from(file_b64, "base64");
  const filePath = path.join(os.tmpdir(), `yt_${Date.now()}.${ext || type}`);
  await fs.writeFile(filePath, buffer);
  return { stream: fs.createReadStream(filePath), filePath, title, author };
}

async function cleanTemp(filePath) {
  try { if (await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
// تحميل وإرسال
// ═══════════════════════════════════════════════════════════════
async function downloadAndSend(statusMsgId, query, wantMp4, api, threadID) {
  const updateStatus = async (text) => {
    try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
  };

  const type = wantMp4 ? "mp4" : "mp3";
  let result;
  try {
    result = await hfDownload(query, type);
  } catch (e) {
    const msg = e.response?.data?.error || e.message;
    return updateStatus(`❌ ${msg}`);
  }

  const { stream, filePath, title, author } = result;
  try {
    await new Promise((resolve, reject) =>
      api.sendMessage(
        {
          body:       `${wantMp4 ? "🎬" : "🎵"} ${title}\n📺 ${author}`.trim(),
          attachment: stream
        },
        threadID,
        err => err ? reject(err) : resolve()
      )
    );

    if (statusMsgId) {
      try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
    }

    await sendDanceSticker(api, threadID);
  } finally {
    await cleanTemp(filePath);
  }
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:      "yt",
    aliases:   ["ytdl", "youtube", "mp3", "mp4", "yts"],
    version:   "4.0",
    role:      0,
    countDown: 15,
    category:  "download",
    guide: { en:
      "{pn} <اسم>         — بحث وعرض قائمة\n" +
      "{pn} mp4 <اسم>     — بحث وعرض قائمة (فيديو)\n" +
      "{pn} <رابط>        — تحميل مباشر MP3\n" +
      "{pn} mp4 <رابط>   — تحميل مباشر MP4"
    }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 yt <اسم أغنية>    — بحث وقائمة\n" +
      "🎬 yt mp4 <اسم>      — بحث وقائمة فيديو\n" +
      "🔗 yt <رابط>         — تحميل مباشر"
    );

    const sub     = args[0].toLowerCase();
    const wantMp4 = sub === "mp4";
    const hasFlag = ["mp4", "mp3"].includes(sub);
    const query   = (hasFlag ? args.slice(1) : args).join(" ").trim();
    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");

    // ── رابط مباشر → تحميل فوري ───────────────────────────
    const isUrl = query.startsWith("http://") || query.startsWith("https://");
    if (isUrl) {
      let statusMsgId = null;
      try {
        const sent = await new Promise((resolve, reject) =>
          api.sendMessage(
            `⏳ ${wantMp4 ? "🎬 جارٍ تحميل الفيديو..." : "🎵 جارٍ تحميل الصوت..."}`,
            threadID, (err, info) => err ? reject(err) : resolve(info), messageID
          )
        );
        statusMsgId = sent?.messageID;
      } catch (_) {}

      try {
        await downloadAndSend(statusMsgId, query, wantMp4, api, threadID);
      } catch (e) {
        try {
          if (statusMsgId) await api.editMessage("❌ " + (e.response?.data?.error || e.message), statusMsgId);
        } catch (_) {}
      }
      return;
    }

    // ── بحث → قائمة نتائج ─────────────────────────────────
    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(
          `🔍 جارٍ البحث عن "${query}"...`,
          threadID, (err, info) => err ? reject(err) : resolve(info), messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    try {
      const results = await hfSearch(query, 7);
      if (!results.length) return updateStatus("❌ لم تُعثر على نتائج.");

      let text = `🎵 نتائج البحث:\n─────────────────\n`;
      results.slice(0, 7).forEach((v, i) => {
        const [mp3Emoji, mp4Emoji] = EMOJI_PAIRS[i];
        text += `${i + 1}. ${v.title}\n   ⏱ ${v.duration || "--"}\n   ${mp3Emoji} mp3  |  ${mp4Emoji} mp4\n─────────────────\n`;
      });
      text += `🔢 رُد بالرقم، أو تفاعل بإيموجي (mp3/mp4)\n⏳ تنتهي بعد دقيقتين.`;

      await updateStatus(text);

      if (statusMsgId) {
        global.Kagenou.replies[statusMsgId] = {
          commandName: "yt",
          author:      event.senderID,
          results:     results.slice(0, 7),
          wantMp4,
          statusMsgId,
          timestamp:   Date.now()
        };

        global.client.reactionListener[statusMsgId] = {
          author: event.senderID,
          callback: async ({ api, event: reactEvent }) => {
            const reaction = reactEvent.reaction;
            const idx = EMOJI_PAIRS.findIndex(([mp3, mp4]) => reaction === mp3 || reaction === mp4);
            if (idx === -1 || idx >= results.length) return;

            const wantMp4R = reaction === EMOJI_PAIRS[idx][1];
            const chosen   = results[idx];

            delete global.client.reactionListener[statusMsgId];
            delete global.Kagenou.replies[statusMsgId];

            await updateStatus(`⏳ جارٍ تحميل: ${chosen.title}...`);
            try {
              await downloadAndSend(statusMsgId, chosen.url || chosen.short_url, wantMp4R, api, threadID);
            } catch (e) {
              await updateStatus("❌ " + (e.response?.data?.error || e.message));
            }
          }
        };

        setTimeout(() => {
          delete global.client.reactionListener[statusMsgId];
        }, 120000);
      }
    } catch (e) {
      await updateStatus("❌ " + (e.response?.data?.error || e.message));
    }
  },

  onReply: async ({ api, event, Reply, message }) => {
    if (event.senderID !== Reply.author || !Reply.results) return;

    const { threadID } = event;
    const parts   = event.body?.trim().split(/\s+/) || [];
    const idx     = parseInt(parts[0]) - 1;
    const wantMp4 = parts[1]?.toLowerCase() === "mp4" ? true
                  : parts[1]?.toLowerCase() === "mp3" ? false
                  : Reply.wantMp4 ?? false;

    if (isNaN(idx) || idx < 0 || idx >= Reply.results.length)
      return message.reply(`❌ أرسل رقماً من 1 إلى ${Reply.results.length}`);

    const chosen      = Reply.results[idx];
    const statusMsgId = Reply.statusMsgId;

    delete global.client.reactionListener[statusMsgId];
    delete global.Kagenou.replies[statusMsgId];

    const updateStatus = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    await updateStatus(`⏳ جارٍ تحميل: ${chosen.title}...`);

    try {
      await downloadAndSend(statusMsgId, chosen.url || chosen.short_url, wantMp4, api, threadID);
    } catch (e) {
      const status = e.response?.status;
      const msg = status === 502 || status === 503
        ? "⚠️ سيرفر التحميل مشغول، حاول بعد لحظة."
        : "❌ " + (e.response?.data?.error || e.message);
      await updateStatus(msg);
    }
  }
};

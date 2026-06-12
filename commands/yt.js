const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const BASE = "https://yt-dlp-stream.onrender.com/api";

// ─── تحميل الملف ─────────────────────────────────────────────
async function getStream(url) {
  const ext      = url.match(/\.(mp4|mp3|webm|m4a)/i)?.[1] || "mp3";
  const filePath = path.join(os.tmpdir(), `yt_${Date.now()}.${ext}`);
  const res = await axios.get(url, {
    responseType: "arraybuffer", timeout: 120000,
    maxContentLength: 50 * 1024 * 1024, maxBodyLength: 50 * 1024 * 1024,
  });
  const buffer = Buffer.from(res.data);
  if (buffer.length === 0)      throw new Error("الملف فارغ.");
  if (buffer.length > 26214400) throw new Error("الملف أكبر من 25MB.");
  await fs.writeFile(filePath, buffer);
  return { stream: fs.createReadStream(filePath), filePath };
}

async function cleanTemp(filePath) {
  try { if (await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
}

function safeUnsend(message, wait) {
  const id = wait?.messageID || wait;
  if (!id) return;
  try {
    if (typeof message.unsend === "function") message.unsend(id);
    else if (global.botApi?.unsendMessage) global.botApi.unsendMessage(id);
  } catch (_) {}
}

// ─── البحث عبر ytsearch (يوتيوب مباشرة) ─────────────────────
async function ytsearch(query, limit = 8) {
  try {
    // API 1: yt-search مجاني
    const res = await axios.get("https://yt-search-api.vercel.app/search", {
      params: { q: query, maxResults: limit },
      timeout: 15000,
    });
    const items = res.data?.items || res.data?.results || res.data || [];
    if (Array.isArray(items) && items.length > 0) {
      return items.slice(0, limit).map(v => ({
        title:        v.title || v.name || "بدون عنوان",
        channel_name: v.channel?.name || v.author || v.channelTitle || "",
        duration:     v.duration || "",
        views:        v.views || v.viewCount || 0,
        url:          v.url || v.link || `https://www.youtube.com/watch?v=${v.id || v.videoId}`,
        videoId:      v.id || v.videoId || "",
      }));
    }
  } catch (_) {}

  try {
    // API 2: احتياطي
    const res = await axios.get(`https://yt-search3.p.rapidapi.com/search`, {
      params: { query, type: "video" },
      headers: { "X-RapidAPI-Host": "yt-search3.p.rapidapi.com" },
      timeout: 15000,
    });
    const items = res.data?.data || [];
    if (Array.isArray(items) && items.length > 0) {
      return items.slice(0, limit).map(v => ({
        title:        v.title || "بدون عنوان",
        channel_name: v.channelTitle || "",
        duration:     v.duration || "",
        views:        v.viewCount || 0,
        url:          `https://www.youtube.com/watch?v=${v.videoId}`,
        videoId:      v.videoId || "",
      }));
    }
  } catch (_) {}

  // API 3: v3 الأصلي كـ fallback أخير
  try {
    const res  = await axios.get(`${BASE}/v3/q`, {
      params: { "": query, " ": limit }, timeout: 25000,
    });
    const data = res.data;
    const items = Array.isArray(data) ? data
      : Array.isArray(data?.results) ? data.results
      : Array.isArray(data?.data)    ? data.data
      : [];
    return items.slice(0, limit);
  } catch (_) {}

  return [];
}

// ─── v2: جلب روابط التحميل ───────────────────────────────────
async function v2(query) {
  const res  = await axios.get(`${BASE}/v2/q`, { params: { "": query }, timeout: 30000 });
  const data = res.data;
  if (Array.isArray(data)) return data[0] || {};
  return data || {};
}

// ─── parse روابط التحميل ─────────────────────────────────────
function parse(d) {
  if (!d || typeof d !== "object") return { title: "بدون عنوان", author: "", mp4Url: null, mp3Url: null };
  const m = (d.media && typeof d.media === "object" && !Array.isArray(d.media)) ? d.media : {};
  function getUrl(f) {
    if (!f) return null;
    if (typeof f === "string" && f.startsWith("http")) return f;
    if (typeof f === "object") return f.url || f.download || f.link || null;
    return null;
  }
  return {
    title:  d.title  || "بدون عنوان",
    author: d.author || d.channel || d.channel_name || "",
    mp4Url: getUrl(m.mp4) || getUrl(d.mp4) || getUrl(d.video) || null,
    mp3Url: getUrl(m.mp3) || getUrl(d.mp3) || getUrl(d.audio) || getUrl(d.download) || null,
  };
}

// ─── تحميل وإرسال ────────────────────────────────────────────
async function downloadAndSend(message, wait, query, wantMp4) {
  const p   = parse(await v2(query));
  const url = wantMp4 ? p.mp4Url : p.mp3Url;

  if (!url) {
    safeUnsend(message, wait);
    return message.reply(`❌ الرابط غير متاح.\n💡 جرّب النوع الآخر.`);
  }

  const { stream, filePath } = await getStream(url);
  safeUnsend(message, wait);
  try {
    await message.reply({
      body:       `${wantMp4 ? "🎬" : "🎵"} ${p.title}\n📺 ${p.author}`.trim(),
      attachment: stream,
    });
  } finally { await cleanTemp(filePath); }
}

module.exports = {
  config: {
    name:      "yt",
    aliases:   ["ytdl", "youtube", "mp3", "mp4", "yts"],
    version:   "4.0",
    role:      0,
    countDown: 15,
    category:  "download",
    guide: { en:
      "{pn} <اسم>       — بحث وعرض قائمة\n" +
      "{pn} mp4 <اسم>   — بحث وقائمة فيديو\n" +
      "{pn} <رابط>      — تحميل مباشر MP3\n" +
      "{pn} mp4 <رابط>  — تحميل مباشر MP4"
    },
  },

  onStart: async ({ message, args, event }) => {
    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 yt <اسم>      — بحث وقائمة\n" +
      "🎬 yt mp4 <اسم>  — بحث وقائمة فيديو\n" +
      "🔗 yt <رابط>     — تحميل مباشر"
    );

    const sub     = args[0].toLowerCase();
    const wantMp4 = sub === "mp4";
    const hasFlag = ["mp4", "mp3"].includes(sub);
    const query   = (hasFlag ? args.slice(1) : args).join(" ").trim();

    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");

    // ── رابط مباشر ───────────────────────────────────────────
    if (query.startsWith("http://") || query.startsWith("https://")) {
      const wait = await message.reply(`⏳ ${wantMp4 ? "🎬 جارٍ تحميل الفيديو..." : "🎵 جارٍ تحميل الصوت..."}`);
      try {
        await downloadAndSend(message, wait, query, wantMp4);
      } catch (e) {
        safeUnsend(message, wait);
        message.reply("❌ " + (e.response?.data?.error || e.message));
      }
      return;
    }

    // ── بحث ──────────────────────────────────────────────────
    const wait = await message.reply(`🔍 جارٍ البحث عن "${query}"...`);
    try {
      const results = await ytsearch(query, 8);
      safeUnsend(message, wait);

      if (!results.length)
        return message.reply("❌ لم تُعثر على نتائج.");

      let text = `🎵 نتائج "${query}":\n${"─".repeat(28)}\n`;
      results.forEach((v, i) => {
        text += `${i + 1}. ${v.title}\n`;
        text += `   📺 ${v.channel_name || ""}  ⏱ ${v.duration || ""}  👁 ${Number(v.views || 0).toLocaleString()}\n`;
        text += `${"─".repeat(28)}\n`;
      });
      text += wantMp4
        ? "✏️ رُد بالرقم → فيديو MP4"
        : "✏️ رُد بالرقم → MP3 | رقم + mp4 → فيديو";

      const info = await message.reply(text);
      if (info?.messageID) {
        global.Kagenou.replies[info.messageID] = {
          commandName: "yt",
          author:      event.senderID,
          results,
          wantMp4,
          timestamp:   Date.now(),
        };
      }
    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  },

  onReply: async ({ event, Reply, message }) => {
    if (event.senderID !== Reply.author || !Reply.results) return;

    const parts   = event.body?.trim().split(/\s+/) || [];
    const idx     = parseInt(parts[0]) - 1;
    const wantMp4 = parts[1]?.toLowerCase() === "mp4" ? true
      : parts[1]?.toLowerCase() === "mp3" ? false
      : Reply.wantMp4 ?? false;

    if (isNaN(idx) || idx < 0 || idx >= Reply.results.length)
      return message.reply(`❌ أرسل رقماً من 1 إلى ${Reply.results.length}`);

    const chosen = Reply.results[idx];
    const wait   = await message.reply(`⏳ جارٍ تحميل: ${chosen.title}...`);

    try {
      await downloadAndSend(message, wait, chosen.url || chosen.short_url, wantMp4);
    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  },
};

const axios = require("axios");
const { safeUnsend } = require("../utils/mediaHelper");

const BASE = "https://yt-dlp-stream.onrender.com/api";

async function v1(query) {
  const { data } = await axios.get(`${BASE}/v1/q`, { params: { "": query }, timeout: 30000 });
  return data;
}
async function v2(query) {
  const { data } = await axios.get(`${BASE}/v2/q`, { params: { "": query }, timeout: 25000 });
  return data;
}
async function v3(query, limit = 8) {
  const { data } = await axios.get(`${BASE}/v3/q`, { params: { "": query, " ": limit }, timeout: 25000 });
  return data;
}

// ─── استخرج من البنية الفعلية للـ API ────────────────────────
// v1: data.info.title / data.media.mp4.url / data.media.mp3.url
// v2: data.title      / data.media.mp4.url / data.media.mp3.url
function parseResponse(d) {
  const title     = d.info?.title     || d.title     || "بدون عنوان";
  const author    = d.info?.author    || d.author    || "";
  const thumbnail = d.info?.thumbnail || d.thumbnail || null;
  const duration  = d.info?.duration  || d.duration  || "";
  const views     = d.info?.views     || d.views     || 0;
  const mp4Url    = d.media?.mp4?.url || d.media?.mp4 || null;
  const mp3Url    = d.media?.mp3?.url || d.media?.mp3 || null;
  const shortUrl  = d.short_url || d.url || "";
  const category  = d.category  || "";
  return { title, author, thumbnail, duration, views, mp4Url, mp3Url, shortUrl, category };
}

module.exports = {
  config: {
    name: "yt",
    aliases: ["ytdl", "youtube", "mp3", "mp4", "yts"],
    version: "2.1",
    role: 0,
    countDown: 15,
    category: "download",
    guide: {
      en:
        "{pn} <اسم/رابط>        — تحميل MP3\n" +
        "{pn} mp4 <اسم/رابط>   — تحميل فيديو HD\n" +
        "{pn} search <كلمة>    — بحث 8 نتائج\n" +
        "{pn} info <اسم/رابط>  — معلومات كاملة"
    }
  },

  onStart: async ({ message, args, event }) => {
    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 .yt <اسم أو رابط>        — تحميل MP3\n" +
      "🎬 .yt mp4 <اسم أو رابط>   — تحميل فيديو HD\n" +
      "🔍 .yt search <كلمة>       — بحث 8 نتائج\n" +
      "ℹ️  .yt info <اسم أو رابط>  — معلومات كاملة"
    );

    const sub      = args[0].toLowerCase();
    const hasFlag  = ["mp4", "mp3", "search", "info"].includes(sub);
    const query    = (hasFlag ? args.slice(1) : args).join(" ");

    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");

    // ── بحث ──────────────────────────────────────────────────
    if (sub === "search") {
      const wait = await message.reply(`🔍 جارٍ البحث عن "${query}"...`);
      try {
        const res = await v3(query, 8);
        safeUnsend(message, wait);
        if (!res.results?.length) return message.reply("❌ لم تُعثر على نتائج.");

        let text = `🔍 نتائج "${query}":\n\n`;
        res.results.forEach((v, i) => {
          text += `${i + 1}. ${v.title}\n`;
          text += `   📺 ${v.channel_name || ""}  ⏱ ${v.duration || ""}  👁 ${Number(v.views || 0).toLocaleString()}\n\n`;
        });
        text += "✏️ رُد بالرقم → MP3 | رقم + mp4 → فيديو";

        return message.reply(text, (err, info) => {
          if (err || !info) return;
          global.Kagenou.replies[info.messageID] = {
            commandName: "yt",
            author: event.senderID,
            results: res.results,
            timestamp: Date.now()
          };
        });
      } catch (e) {
        safeUnsend(message, wait);
        return message.reply("❌ " + (e.response?.data?.error || e.message));
      }
    }

    // ── معلومات ───────────────────────────────────────────────
    if (sub === "info") {
      const wait = await message.reply(`ℹ️ جارٍ جلب معلومات...`);
      try {
        const d  = await v1(query);
        const p  = parseResponse(d);
        safeUnsend(message, wait);

        let thumb = null;
        if (p.thumbnail) {
          try { thumb = await global.utils.getStreamFromURL(p.thumbnail, "thumb.jpg"); } catch (_) {}
        }

        const text =
          `🎬 ${p.title}\n` +
          `📺 ${p.author}\n` +
          `⏱ ${p.duration}  👁 ${Number(p.views).toLocaleString()}\n` +
          `📂 ${p.category}\n` +
          `🔗 ${p.shortUrl}`;

        return message.reply(thumb ? { body: text, attachment: thumb } : text);
      } catch (e) {
        safeUnsend(message, wait);
        return message.reply("❌ " + (e.response?.data?.error || e.message));
      }
    }

    // ── تحميل MP3 / MP4 ───────────────────────────────────────
    const wantMp4 = sub === "mp4";
    const wait    = await message.reply(`⏳ ${wantMp4 ? "🎬 جارٍ تحميل الفيديو..." : "🎵 جارٍ تحميل الصوت..."}`);
    try {
      const d   = await v1(query);
      const p   = parseResponse(d);
      const url = wantMp4 ? p.mp4Url : p.mp3Url;

      if (!url) {
        safeUnsend(message, wait);
        return message.reply(`❌ الرابط غير متاح.\n💡 جرّب: .yt ${wantMp4 ? "" : "mp4 "}${query}`);
      }

      const ext    = wantMp4 ? "mp4" : "mp3";
      const stream = await global.utils.getStreamFromURL(url, `yt.${ext}`);
      safeUnsend(message, wait);
      return message.reply({
        body: `${wantMp4 ? "🎬" : "🎵"} ${p.title}\n📺 ${p.author}`.trim(),
        attachment: stream
      });
    } catch (e) {
      safeUnsend(message, wait);
      return message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  },

  // ─── رد على نتائج البحث ──────────────────────────────────────
  onReply: async ({ event, Reply, message }) => {
    if (event.senderID !== Reply.author || !Reply.results) return;

    const parts   = event.body?.trim().split(/\s+/) || [];
    const idx     = parseInt(parts[0]) - 1;
    const wantMp4 = parts[1]?.toLowerCase() === "mp4";

    if (isNaN(idx) || idx < 0 || idx >= Reply.results.length)
      return message.reply(`❌ أرسل رقماً من 1 إلى ${Reply.results.length}`);

    const chosen = Reply.results[idx];
    const wait   = await message.reply(`⏳ جارٍ تحميل "${chosen.title}"...`);
    try {
      const d   = await v1(chosen.url || chosen.short_url);
      const p   = parseResponse(d);
      const url = wantMp4 ? p.mp4Url : p.mp3Url;

      if (!url) {
        safeUnsend(message, wait);
        return message.reply("❌ الرابط غير متاح.");
      }

      const ext    = wantMp4 ? "mp4" : "mp3";
      const stream = await global.utils.getStreamFromURL(url, `yt.${ext}`);
      safeUnsend(message, wait);
      message.reply({ body: `${wantMp4 ? "🎬" : "🎵"} ${p.title}`, attachment: stream });
    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  }
};

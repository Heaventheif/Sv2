const axios = require("axios");

const BASE = "https://yt-dlp-stream.onrender.com/api";

// ─── تحميل الملف على /tmp ثم إرساله كـ ReadStream ──────────
// نفس طريقة sing.js — متوافق مع render
const fs   = require("fs-extra");
const os   = require("os");
const path = require("path");

async function getStream(url) {
  const ext      = url.match(/\.(mp4|mp3|webm|m4a)/i)?.[1] || "mp3";
  const filePath = path.join(os.tmpdir(), `yt_${Date.now()}.${ext}`);

  const res = await axios.get(url, {
    responseType:      "arraybuffer",
    timeout:           120000,
    maxContentLength:  50 * 1024 * 1024,  // 50MB
    maxBodyLength:     50 * 1024 * 1024,
  });

  const buffer = Buffer.from(res.data);
  if (buffer.length === 0)          throw new Error("الملف فارغ.");
  if (buffer.length > 26214400)     throw new Error("الملف أكبر من 25MB.");

  await fs.writeFile(filePath, buffer);
  return { stream: fs.createReadStream(filePath), filePath };
}

async function cleanTemp(filePath) {
  try { if (await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
}

// ─── حذف رسالة الانتظار بأمان ────────────────────────────────
function safeUnsend(message, wait) {
  const id = wait?.messageID || wait;
  if (!id) return;
  try {
    if (typeof message.unsend === "function") message.unsend(id);
    else if (global.botApi?.unsendMessage) global.botApi.unsendMessage(id);
  } catch (_) {}
}

// ─── طلبات الـ API ────────────────────────────────────────────
async function v1(query) {
  // الـ API يستخدم v2 — المفتاح فارغ "" كما هو في الـ URL: /api/v2/q?=query
  const res = await axios.get(`${BASE}/v2/q`, { params: { "": query }, timeout: 30000 });
  const data = res.data;
  if (Array.isArray(data)) return data[0] || {};
  if (!data || typeof data !== "object") return {};
  return data;
}
async function v3(query, limit = 8) {
  const res = await axios.get(`${BASE}/v3/q`, { params: { "": query, " ": limit }, timeout: 25000 });
  const data = res.data;
  if (Array.isArray(data)) return { results: data };
  if (!data || typeof data !== "object") return { results: [] };
  // بعض الـ APIs تُعيد المصفوفة مباشرة داخل data أو results
  if (Array.isArray(data.results)) return data;
  if (Array.isArray(data.data)) return { results: data.data };
  return { results: [] };
}

// ─── تحليل response الفعلي ───────────────────────────────────
// بنية الـ API v2:
// { title, media: { mp4: "url_string", mp3: "url_string" }, ... }
function parse(d) {
  if (!d || typeof d !== "object") return {
    title: "بدون عنوان", author: "", thumbnail: null,
    duration: "", views: 0, mp4Url: null, mp3Url: null,
    shortUrl: "", category: ""
  };

  // media قد يكون كائناً { mp4: string, mp3: string }
  const m = (d.media && typeof d.media === "object" && !Array.isArray(d.media))
    ? d.media : {};

  // استخرج الرابط: إما string مباشرة أو { url: string }
  function getUrl(field) {
    if (!field) return null;
    if (typeof field === "string") return field;
    if (typeof field === "object" && typeof field.url === "string") return field.url;
    return null;
  }

  return {
    title:     d.title     || d.info?.title     || "بدون عنوان",
    author:    d.author    || d.info?.author    || d.channel || "",
    thumbnail: d.thumbnail || d.info?.thumbnail || null,
    duration:  d.duration  || d.info?.duration  || "",
    views:     d.views     || d.info?.views     || 0,
    mp4Url:    getUrl(m.mp4)  || getUrl(d.mp4)  || getUrl(d.videoUrl) || null,
    mp3Url:    getUrl(m.mp3)  || getUrl(d.mp3)  || getUrl(d.audioUrl) || null,
    shortUrl:  d.short_url || d.url || "",
    category:  d.category  || ""
  };
}

module.exports = {
  config: {
    name: "yt",
    aliases: ["ytdl", "youtube", "mp3", "mp4", "yts"],
    version: "2.2",
    role: 0,
    countDown: 15,
    category: "download",
    guide: {
      en:
        "{pn} <اسم/رابط>       — تحميل MP3\n" +
        "{pn} mp4 <اسم/رابط>  — تحميل فيديو HD\n" +
        "{pn} search <كلمة>   — بحث 8 نتائج\n" +
        "{pn} info <اسم/رابط> — معلومات كاملة"
    }
  },

  onStart: async ({ message, args, event }) => {
    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 .yt <اسم أو رابط>       — تحميل MP3\n" +
      "🎬 .yt mp4 <اسم أو رابط>  — تحميل فيديو HD\n" +
      "🔍 .yt search <كلمة>      — بحث 8 نتائج\n" +
      "ℹ️  .yt info <اسم أو رابط> — معلومات كاملة"
    );

    const sub     = args[0].toLowerCase();
    const hasFlag = ["mp4", "mp3", "search", "info"].includes(sub);
    const query   = (hasFlag ? args.slice(1) : args).join(" ");
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
      const wait = await message.reply("ℹ️ جارٍ جلب المعلومات...");
      try {
        const p = parse(await v1(query));
        safeUnsend(message, wait);

        let thumb = null;
        if (p.thumbnail) {
          try { thumb = await getStream(p.thumbnail); } catch (_) {}
        }

        const text =
          `🎬 ${p.title}\n📺 ${p.author}\n` +
          `⏱ ${p.duration}  👁 ${Number(p.views).toLocaleString()}\n` +
          `📂 ${p.category}\n🔗 ${p.shortUrl}`;

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
      const p   = parse(await v1(query));
      const url = wantMp4 ? p.mp4Url : p.mp3Url;

      if (!url) {
        safeUnsend(message, wait);
        return message.reply(`❌ الرابط غير متاح.\n💡 جرّب: .yt ${wantMp4 ? "" : "mp4 "}${query}`);
      }

      const { stream, filePath } = await getStream(url);
      safeUnsend(message, wait);
      try {
        await message.reply({
          body:       `${wantMp4 ? "🎬" : "🎵"} ${p.title}\n📺 ${p.author}`.trim(),
          attachment: stream
        });
      } finally { await cleanTemp(filePath); }
      return;
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
      const p   = parse(await v1(chosen.url || chosen.short_url));
      const url = wantMp4 ? p.mp4Url : p.mp3Url;

      if (!url) {
        safeUnsend(message, wait);
        return message.reply("❌ الرابط غير متاح.");
      }

      const { stream, filePath } = await getStream(url);
      safeUnsend(message, wait);
      try {
        await message.reply({
          body:       `${wantMp4 ? "🎬" : "🎵"} ${p.title}`.trim(),
          attachment: stream
        });
      } finally { await cleanTemp(filePath); }
    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  }
};

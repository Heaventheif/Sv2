const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const BASE = "https://yt-dlp-stream.onrender.com/api";

// ─── تحميل الملف على /tmp ثم إرساله كـ ReadStream ────────────
async function getStream(url) {
  const ext      = url.match(/\.(mp4|mp3|webm|m4a)/i)?.[1] || "mp3";
  const filePath = path.join(os.tmpdir(), `yt_${Date.now()}.${ext}`);

  const res = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength:    50 * 1024 * 1024,
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

// ─── حذف رسالة الانتظار بأمان ────────────────────────────────
function safeUnsend(message, wait) {
  const id = wait?.messageID || wait;
  if (!id) return;
  try {
    if (typeof message.unsend === "function") message.unsend(id);
    else if (global.botApi?.unsendMessage) global.botApi.unsendMessage(id);
  } catch (_) {}
}

// ─── v2: جلب روابط التحميل ────────────────────────────────────
async function v2(query) {
  const res  = await axios.get(`${BASE}/v2/q`, { params: { "": query }, timeout: 30000 });
  const data = res.data;
  if (Array.isArray(data)) return data[0] || {};
  if (!data || typeof data !== "object") return {};
  return data;
}

// ─── v3: بحث وإعادة قائمة ────────────────────────────────────
async function v3(query, limit = 8) {
  const res  = await axios.get(`${BASE}/v3/q`, { params: { "": query, " ": limit }, timeout: 25000 });
  const data = res.data;
  if (Array.isArray(data))           return { results: data };
  if (!data || typeof data !== "object") return { results: [] };
  if (Array.isArray(data.results))   return data;
  if (Array.isArray(data.data))      return { results: data.data };
  return { results: [] };
}

// ─── استخرج روابط من v2 response ─────────────────────────────
function parse(d) {
  if (!d || typeof d !== "object") return {
    title: "بدون عنوان", author: "", mp4Url: null, mp3Url: null
  };
  const m = (d.media && typeof d.media === "object" && !Array.isArray(d.media)) ? d.media : {};
  function getUrl(f) {
    if (!f) return null;
    if (typeof f === "string") return f;
    if (typeof f === "object" && typeof f.url === "string") return f.url;
    return null;
  }
  return {
    title:  d.title  || "بدون عنوان",
    author: d.author || d.channel || "",
    mp4Url: getUrl(m.mp4) || getUrl(d.mp4) || null,
    mp3Url: getUrl(m.mp3) || getUrl(d.mp3) || null,
  };
}

// ─── تحميل وإرسال ─────────────────────────────────────────────
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
      attachment: stream
    });
  } finally { await cleanTemp(filePath); }
}

module.exports = {
  config: {
    name:      "yt",
    aliases:   ["ytdl", "youtube", "mp3", "mp4", "yts"],
    version:   "3.0",
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

  // ─── onStart ──────────────────────────────────────────────────
  onStart: async ({ message, args, event }) => {
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

    // ── رابط مباشر → تحميل فوري ──────────────────────────────
    const isUrl = query.startsWith("http://") || query.startsWith("https://");
    if (isUrl) {
      const wait = await message.reply(`⏳ ${wantMp4 ? "🎬 جارٍ تحميل الفيديو..." : "🎵 جارٍ تحميل الصوت..."}`);
      try {
        await downloadAndSend(message, wait, query, wantMp4);
      } catch (e) {
        safeUnsend(message, wait);
        message.reply("❌ " + (e.response?.data?.error || e.message));
      }
      return;
    }

    // ── اسم أغنية → بحث وعرض قائمة ──────────────────────────
    const wait = await message.reply(`🔍 جارٍ البحث عن "${query}"...`);
    try {
      const res = await v3(query, 8);
      safeUnsend(message, wait);

      if (!res.results?.length)
        return message.reply("❌ لم تُعثر على نتائج.");

      let text = `🎵 نتائج "${query}":\n${"─".repeat(28)}\n`;
      res.results.forEach((v, i) => {
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
          results:     res.results,
          wantMp4,          // ← يحفظ نوع الطلب الأصلي
          timestamp:   Date.now()
        };
      }
    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  },

  // ─── onReply: المستخدم يختار رقماً ───────────────────────────
  onReply: async ({ event, Reply, message }) => {
    if (event.senderID !== Reply.author || !Reply.results) return;

    const parts   = event.body?.trim().split(/\s+/) || [];
    const idx     = parseInt(parts[0]) - 1;
    // يمكن تغيير النوع بكتابة "1 mp4" أو "1 mp3"
    const wantMp4 = parts[1]?.toLowerCase() === "mp4"
      ? true
      : parts[1]?.toLowerCase() === "mp3"
        ? false
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
  }
};

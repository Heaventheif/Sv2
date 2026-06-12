const axios = require("axios");
const BASE   = "https://free-goat-api.onrender.com";

// ─── طلب GET بسيط ────────────────────────────────────────────
async function apiFetch(endpoint, params = {}) {
  const query = new URLSearchParams(params).toString();
  const { data } = await axios.get(`${BASE}/${endpoint}?${query}`);
  return data;
}

// ─── استخرج أول رابط وسائط من استجابة الـ API ───────────────
function extractUrl(data) {
  return (
    data.videoUrl || data.imageUrl || data.audioUrl ||
    data.url      || data.download || data.audio    ||
    data.image    || data.result   || data.directUrl||
    data.hd       || data.sd       || data.nowm     ||
    data.shortUrl || data.tinyurl  || data.link     ||
    data.display_url || null
  );
}

// ─── حذف رسالة الانتظار بأمان (يدعم api.unsendMessage و message.unsend) ──
function safeUnsend(message, msgID) {
  try {
    if (typeof message.unsend === "function") {
      message.unsend(msgID);
    } else if (global.botApi?.unsendMessage) {
      global.botApi.unsendMessage(msgID);
    }
  } catch (_) {}
}

// ─── رسالة انتظار ثم ترسل الملف أو النص ─────────────────────
async function sendMedia(message, waitMsg, data, body) {
  const url = extractUrl(data);
  if (!url) {
    safeUnsend(message, waitMsg.messageID);
    return message.reply("❌ لم يُعثر على محتوى.\n" + JSON.stringify(data).substring(0, 250));
  }

  const isText = url.startsWith("http") && (
    url.includes("tinyurl") || url.includes("ibb.co") || !url.match(/\.(mp4|mp3|png|jpg|jpeg|gif|webp)/i)
  );

  safeUnsend(message, waitMsg.messageID);

  if (isText) {
    return message.reply(`${body}\n🔗 ${url}`);
  }

  const ext    = url.match(/\.(mp4|mp3|png|jpg|jpeg|gif|webp)/i)?.[1] || "mp4";
  const stream = await global.utils.getStreamFromURL(url, `file.${ext}`);
  return message.reply({ body, attachment: stream });
}

// ─── استخرج صورة من الرد أو المرفق ──────────────────────────
function getImageUrl(event) {
  const att =
    event.messageReply?.attachments?.[0] ||
    event.attachments?.[0];
  if (!att || !["photo","sticker"].includes(att.type)) return null;
  return att.url || att.previewUrl;
}

module.exports = { apiFetch, extractUrl, sendMedia, safeUnsend, getImageUrl };

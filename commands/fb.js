const axios = require("axios");

const FDOWN_API = "https://fdown.isuru.eu.org";

// ─── جلب stream مباشرة ────────────────────────────────────────
async function getStream(url) {
  const res = await axios.get(url, { responseType: "stream", timeout: 60000 });
  return res.data;
}

// ─── حذف رسالة انتظار بأمان ───────────────────────────────────
function safeUnsend(message, wait) {
  const id = wait?.messageID || wait;
  if (!id) return;
  try {
    if (typeof message.unsend === "function") message.unsend(id);
    else if (global.botApi?.unsendMessage) global.botApi.unsendMessage(id);
  } catch (_) {}
}

module.exports = {
  config: {
    name: "fb",
    aliases: ["facebook", "fbdl"],
    version: "1.0",
    role: 0,
    countDown: 15,
    category: "download",
    longDescription: "تحميل فيديو فيسبوك — يدعم الروابط العادية والروابط المباشرة",
    guide: { en: "{pn} <رابط فيسبوك>" }
  },

  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply(
      "❌ أرسل رابط فيسبوك.\n" +
      "مثال:\n" +
      ".fb https://www.facebook.com/watch?v=xxx\n" +
      ".fb https://fb.watch/xxx"
    );

    const url  = args[0];
    const wait = await message.reply("⏳ جارٍ تحميل الفيديو...");

    try {
      // ─── رابط CDN مباشر (fbcdn.net / fdown stream) ───────────
      if (url.includes("fbcdn.net") || url.includes("fdown.isuru.eu.org/stream")) {
        const stream = await getStream(url);
        safeUnsend(message, wait);
        return message.reply({ body: "✅ تم التحميل! 🎬", attachment: stream });
      }

      // ─── رابط فيسبوك عادي — نمرره لـ fdown API ───────────────
      const { data } = await axios.get(`${FDOWN_API}/api`, {
        params: { url },
        timeout: 30000
      });

      // fdown يرجع: { sd, hd, title, ... }
      const videoUrl = data.hd || data.sd || data.url || data.video;

      if (!videoUrl) {
        safeUnsend(message, wait);
        return message.reply("❌ لم يُعثر على الفيديو.\n" + JSON.stringify(data).substring(0, 200));
      }

      const stream = await getStream(videoUrl);
      safeUnsend(message, wait);
      return message.reply({
        body: `✅ ${data.title || "فيديو فيسبوك"} ${data.hd ? "🔵 HD" : ""}`.trim(),
        attachment: stream
      });

    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ خطأ: " + (e.response?.data?.error || e.message));
    }
  }
};

const axios = require("axios");
const BASE = "https://free-goat-api.onrender.com";

module.exports = {
  config: {
    name: "youtube",
    aliases: ["yt", "ytdl"],
    version: "1.0",
    role: 0,
    author: "Fahim API",
    countDown: 10,
    category: "download",
    longDescription: "تحميل فيديو أو صوت من يوتيوب",
    guide: { en: "{pn} <رابط اليوتيوب>" }
  },

  onStart: async function ({ message, args }) {
    if (!args[0]) return message.reply("❌ أرسل رابط يوتيوب.\nمثال: .youtube https://youtu.be/xxxx");

    const url = args[0];
    const wait = await message.reply("⏳ جارٍ جلب معلومات الفيديو...");

    try {
      const { data } = await axios.get(`${BASE}/youtube?url=${encodeURIComponent(url)}`);

      if (!data) return message.reply("❌ تعذّر جلب الفيديو.");

      // بعض APIs ترجع مباشرة رابط التحميل
      const videoUrl = data.videoUrl || data.url || data.download || data.video;
      if (!videoUrl) return message.reply("❌ لم يُعثر على رابط التحميل.\nتفاصيل: " + JSON.stringify(data).substring(0, 200));

      const stream = await global.utils.getStreamFromURL(videoUrl, "video.mp4");
      message.unsend(wait.messageID);
      message.reply({
        body: `✅ تم التحميل بنجاح!\n🎬 ${data.title || "فيديو يوتيوب"}`,
        attachment: stream
      });
    } catch (err) {
      message.unsend(wait.messageID);
      message.reply("❌ خطأ: " + (err.response?.data?.error || err.message));
    }
  }
};

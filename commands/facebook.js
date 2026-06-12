const axios = require("axios");
const BASE = "https://free-goat-api.onrender.com";

module.exports = {
  config: {
    name: "facebook",
    aliases: ["fb", "fbdl"],
    version: "1.0",
    role: 0,
    author: "Fahim API",
    countDown: 10,
    category: "download",
    longDescription: "تحميل فيديو من فيسبوك",
    guide: { en: "{pn} <رابط الفيديو>" }
  },

  onStart: async function ({ message, args }) {
    if (!args[0]) return message.reply("❌ أرسل رابط فيديو فيسبوك.\nمثال: .fb https://fb.com/...");

    const url = args[0];
    const wait = await message.reply("⏳ جارٍ تحميل الفيديو...");

    try {
      const { data } = await axios.get(`${BASE}/facebook?url=${encodeURIComponent(url)}`);

      const videoUrl = data.videoUrl || data.url || data.download || data.hd || data.sd;
      if (!videoUrl) return message.reply("❌ لم يُعثر على رابط.\n" + JSON.stringify(data).substring(0, 200));

      const stream = await global.utils.getStreamFromURL(videoUrl, "fb-video.mp4");
      message.unsend(wait.messageID);
      message.reply({
        body: "✅ تم تحميل الفيديو من فيسبوك!",
        attachment: stream
      });
    } catch (err) {
      message.unsend(wait.messageID);
      message.reply("❌ خطأ: " + (err.response?.data?.error || err.message));
    }
  }
};

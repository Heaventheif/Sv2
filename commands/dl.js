const axios = require("axios");
const BASE = "https://free-goat-api.onrender.com";

module.exports = {
  config: {
    name: "dl",
    aliases: ["download", "alldl"],
    version: "1.0",
    role: 0,
    author: "Fahim API",
    countDown: 10,
    category: "download",
    longDescription: "تحميل من أي رابط (يوتيوب، تيك توك، إنستغرام، فيسبوك، سبوتيفاي...)",
    guide: { en: "{pn} <أي رابط>" }
  },

  onStart: async function ({ message, args }) {
    if (!args[0]) return message.reply(
      "❌ أرسل رابط.\n" +
      "📥 يدعم: يوتيوب، تيك توك، إنستغرام، فيسبوك، سبوتيفاي، تيرابوكس، جي درايف...\n" +
      "مثال: .dl https://youtu.be/xxxx"
    );

    const url = args[0];
    const wait = await message.reply("⏳ جارٍ التحميل من " + url.split("/")[2] + "...");

    try {
      const { data } = await axios.get(`${BASE}/alldl?url=${encodeURIComponent(url)}`);

      const mediaUrl = data.videoUrl || data.imageUrl || data.url || data.download || data.audio;
      if (!mediaUrl) return message.reply("❌ لم يُعثر على محتوى.\n" + JSON.stringify(data).substring(0, 300));

      const isVideo = mediaUrl.includes(".mp4") || mediaUrl.includes("video");
      const isAudio = mediaUrl.includes(".mp3") || mediaUrl.includes("audio");
      const ext     = isVideo ? "mp4" : isAudio ? "mp3" : "jpg";

      const stream = await global.utils.getStreamFromURL(mediaUrl, `download.${ext}`);
      message.unsend(wait.messageID);
      message.reply({
        body: `✅ تم التحميل بنجاح!\n${data.title ? "🎬 " + data.title : ""}`.trim(),
        attachment: stream
      });
    } catch (err) {
      message.unsend(wait.messageID);
      message.reply("❌ خطأ: " + (err.response?.data?.error || err.message));
    }
  }
};

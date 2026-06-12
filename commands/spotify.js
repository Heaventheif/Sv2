const axios = require("axios");
const BASE = "https://free-goat-api.onrender.com";

module.exports = {
  config: {
    name: "spotify",
    aliases: ["sp", "spdl"],
    version: "1.0",
    role: 0,
    author: "Fahim API",
    countDown: 15,
    category: "download",
    longDescription: "تحميل أغنية من سبوتيفاي",
    guide: { en: "{pn} <رابط سبوتيفاي>" }
  },

  onStart: async function ({ message, args }) {
    if (!args[0]) return message.reply("❌ أرسل رابط سبوتيفاي.\nمثال: .spotify https://open.spotify.com/track/xxxx");

    const url  = args[0];
    const wait = await message.reply("⏳ جارٍ تحميل الأغنية من سبوتيفاي 🎵...");

    try {
      const { data } = await axios.get(`${BASE}/spotify?url=${encodeURIComponent(url)}`);

      const audioUrl = data.audioUrl || data.url || data.download || data.audio;
      if (!audioUrl) return message.reply("❌ لم يُعثر على الأغنية.\n" + JSON.stringify(data).substring(0, 200));

      const stream = await global.utils.getStreamFromURL(audioUrl, "song.mp3");
      message.unsend(wait.messageID);
      message.reply({
        body: `✅ تم تحميل الأغنية! 🎵\n🎤 ${data.title || data.name || "أغنية سبوتيفاي"}\n👤 ${data.artist || data.artists || ""}`.trim(),
        attachment: stream
      });
    } catch (err) {
      message.unsend(wait.messageID);
      message.reply("❌ خطأ: " + (err.response?.data?.error || err.message));
    }
  }
};

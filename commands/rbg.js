const axios = require("axios");
const BASE = "https://free-goat-api.onrender.com";

module.exports = {
  config: {
    name: "rbg",
    aliases: ["removebg", "rmbg", "nobg"],
    version: "1.0",
    role: 0,
    author: "Fahim API",
    countDown: 10,
    category: "image",
    longDescription: "إزالة خلفية الصورة تلقائياً",
    guide: { en: "{pn} — رُد على صورة لإزالة خلفيتها" }
  },

  onStart: async function ({ message, event }) {
    const attachment =
      event.messageReply?.attachments?.[0] ||
      event.attachments?.[0];

    if (!attachment || !["photo", "sticker"].includes(attachment.type)) {
      return message.reply("❌ رُد على صورة لإزالة خلفيتها.\nمثال: رُد على صورة واكتب .rbg");
    }

    const imgUrl = attachment.url || attachment.previewUrl;
    const wait   = await message.reply("⏳ جارٍ إزالة الخلفية...");

    try {
      const { data } = await axios.get(`${BASE}/rbg?url=${encodeURIComponent(imgUrl)}`);

      const resultUrl = data.image || data.url || data.result;
      if (!resultUrl) return message.reply("❌ فشلت العملية.\n" + JSON.stringify(data).substring(0, 200));

      const stream = await global.utils.getStreamFromURL(resultUrl, "no-bg.png");
      message.unsend(wait.messageID);
      message.reply({
        body: "✅ تمت إزالة الخلفية بنجاح! 🖼️",
        attachment: stream
      });
    } catch (err) {
      message.unsend(wait.messageID);
      message.reply("❌ خطأ: " + (err.response?.data?.error || err.message));
    }
  }
};

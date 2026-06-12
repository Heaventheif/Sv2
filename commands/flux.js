const axios = require("axios");
const BASE = "https://free-goat-api.onrender.com";

module.exports = {
  config: {
    name: "flux",
    aliases: ["fluxpro", "imagine", "img"],
    version: "1.0",
    role: 0,
    author: "Fahim API",
    countDown: 20,
    category: "image",
    longDescription: "توليد صورة من نص باستخدام Flux Pro 1.1",
    guide: { en: "{pn} <وصف الصورة> [النسبة: 1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 2:3]" }
  },

  onStart: async function ({ message, args }) {
    if (!args[0]) return message.reply(
      "❌ أرسل وصف الصورة.\n" +
      "مثال: .flux a beautiful sunset over the ocean 16:9\n" +
      "📐 النسب المدعومة: 1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 2:3"
    );

    // استخراج النسبة من آخر argument إذا كانت بصيغة x:x
    const ratioRegex = /^\d+:\d+$/;
    let ratio  = "1:1";
    let prompt = args.join(" ");

    if (ratioRegex.test(args[args.length - 1])) {
      ratio  = args[args.length - 1];
      prompt = args.slice(0, -1).join(" ");
    }

    const wait = await message.reply(`🎨 جارٍ توليد الصورة...\n📝 "${prompt}"\n📐 النسبة: ${ratio}`);

    try {
      const { data } = await axios.get(
        `${BASE}/fluxpro?prompt=${encodeURIComponent(prompt)}&ratio=${encodeURIComponent(ratio)}`
      );

      const imgUrl = data.image || data.url || data.imageUrl;
      if (!imgUrl) return message.reply("❌ فشل التوليد.\n" + JSON.stringify(data).substring(0, 200));

      const stream = await global.utils.getStreamFromURL(imgUrl, "flux.png");
      message.unsend(wait.messageID);
      message.reply({
        body: `✅ تمت إنشاء الصورة بـ Flux Pro!\n🖼️ "${prompt}"`,
        attachment: stream
      });
    } catch (err) {
      message.unsend(wait.messageID);
      message.reply("❌ خطأ: " + (err.response?.data?.error || err.message));
    }
  }
};

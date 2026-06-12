const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");

module.exports = {
  config: {
    name: "dl", aliases: ["download", "alldl"],
    version: "1.0", role: 0, countDown: 10,
    category: "download",
    guide: { en: "{pn} <أي رابط> — يوتيوب، تيك توك، إنستغرام، فيسبوك، سبوتيفاي..." }
  },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل رابطاً.\nمثال: .dl https://youtu.be/xxxx");
    const wait = await message.reply("⏳ جارٍ التحميل...");
    try {
      const data = await apiFetch("alldl", { url: args[0] });
      await sendMedia(message, wait, data, `✅ ${data.title || "تم التحميل!"}`);
    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  }
};

const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");

module.exports = {
  config: {
    name: "tiktok", aliases: ["tt"],
    version: "1.0", role: 0, countDown: 10,
    category: "download",
    guide: { en: "{pn} <رابط تيك توك>" }
  },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل رابط تيك توك.");
    const wait = await message.reply("⏳ جارٍ التحميل بلا علامة مائية...");
    try {
      const data = await apiFetch("tiktok", { url: args[0] });
      await sendMedia(message, wait, data, `🎵 ${data.title || data.desc || "تيك توك"}`);
    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  }
};

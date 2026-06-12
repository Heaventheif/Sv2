const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");

module.exports = {
  config: {
    name: "youtube", aliases: ["yt"],
    version: "1.0", role: 0, countDown: 10,
    category: "download",
    guide: { en: "{pn} <رابط يوتيوب>" }
  },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل رابط يوتيوب.");
    const wait = await message.reply("⏳ جارٍ تحميل الفيديو...");
    try {
      const data = await apiFetch("youtube", { url: args[0] });
      await sendMedia(message, wait, data, `🎬 ${data.title || "فيديو يوتيوب"}`);
    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  }
};

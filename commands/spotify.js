const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "spotify", aliases: ["sp"], version: "1.0", role: 0, countDown: 15, category: "download", guide: { en: "{pn} <رابط سبوتيفاي>" } },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل رابط سبوتيفاي.");
    const wait = await message.reply("⏳ جارٍ تحميل الأغنية 🎵...");
    try {
      const data = await apiFetch("spotify", { url: args[0] });
      await sendMedia(message, wait, data, `🎵 ${data.title || data.name || "أغنية"}\n👤 ${data.artist || ""}`);
    }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

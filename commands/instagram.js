const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "instagram", aliases: ["ig"], version: "1.0", role: 0, countDown: 10, category: "download", guide: { en: "{pn} <رابط إنستغرام>" } },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل رابط إنستغرام.");
    const wait = await message.reply("⏳ جارٍ التحميل...");
    try { await sendMedia(message, wait, await apiFetch("instagram", { url: args[0] }), "📸 إنستغرام"); }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

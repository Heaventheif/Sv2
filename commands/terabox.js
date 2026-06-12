const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "terabox", aliases: ["tb"], version: "1.0", role: 0, countDown: 15, category: "download", guide: { en: "{pn} <رابط Terabox>" } },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل رابط Terabox.");
    const wait = await message.reply("⏳ جارٍ التحميل من Terabox...");
    try { await sendMedia(message, wait, await apiFetch("terabox", { url: args[0] }), "📦 Terabox"); }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

// ─── هذا الملف يُصدِّر أمراً واحداً فقط — facebook ─────────
const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "facebook", aliases: ["fb"], version: "1.0", role: 0, countDown: 10, category: "download", guide: { en: "{pn} <رابط فيسبوك>" } },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل رابط فيسبوك.");
    const wait = await message.reply("⏳ جارٍ تحميل الفيديو...");
    try { await sendMedia(message, wait, await apiFetch("facebook", { url: args[0] }), "📘 فيديو فيسبوك"); }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

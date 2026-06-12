const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "tinyurl", aliases: ["short"], version: "1.0", role: 0, countDown: 5, category: "tools", guide: { en: "{pn} <رابط>" } },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل رابطاً لاختصاره.");
    const wait = await message.reply("⏳ جارٍ اختصار الرابط...");
    try { await sendMedia(message, wait, await apiFetch("tinyurl", { url: args[0] }), "✂️ تم اختصار الرابط!"); }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

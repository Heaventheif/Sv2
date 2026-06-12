const { apiFetch, sendMedia, safeUnsend, getImageUrl } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "rbg", aliases: ["removebg", "rmbg"], version: "1.0", role: 0, countDown: 10, category: "image", guide: { en: "{pn} — رُد على صورة" } },
  onStart: async ({ message, event }) => {
    const imgUrl = getImageUrl(event);
    if (!imgUrl) return message.reply("❌ رُد على صورة لإزالة خلفيتها.");
    const wait = await message.reply("⏳ جارٍ إزالة الخلفية...");
    try { await sendMedia(message, wait, await apiFetch("rbg", { url: imgUrl }), "✅ تمت إزالة الخلفية! 🖼️"); }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

const { apiFetch, sendMedia, safeUnsend, getImageUrl } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "imgbb", aliases: ["uploadimg"], version: "1.0", role: 0, countDown: 5, category: "tools", guide: { en: "{pn} — رُد على صورة لرفعها" } },
  onStart: async ({ message, event }) => {
    const imgUrl = getImageUrl(event);
    if (!imgUrl) return message.reply("❌ رُد على صورة لرفعها.");
    const wait = await message.reply("⏳ جارٍ رفع الصورة...");
    try { await sendMedia(message, wait, await apiFetch("imgbb", { url: imgUrl }), "✅ تم رفع الصورة على Imgbb!"); }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

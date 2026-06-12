const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "gdrive", aliases: ["gd"], version: "1.0", role: 0, countDown: 15, category: "download", guide: { en: "{pn} <رابط Google Drive>" } },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل رابط Google Drive.");
    const wait = await message.reply("⏳ جارٍ التحميل من Drive...");
    try { await sendMedia(message, wait, await apiFetch("gdrive", { url: args[0] }), `📁 ${(await (async()=>{})()) || "ملف Drive"}`); }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

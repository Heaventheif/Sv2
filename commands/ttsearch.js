const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "ttsearch", aliases: ["tts"], version: "1.0", role: 0, countDown: 10, category: "download", guide: { en: "{pn} <كلمة بحث>" } },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل كلمة للبحث في تيك توك.");
    const query = args.join(" ");
    const wait  = await message.reply(`🔍 البحث عن "${query}"...`);
    try {
      const data = await apiFetch("tiktoksearch", { query });
      const first = Array.isArray(data) ? data[0] : data;
      await sendMedia(message, wait, first, `🎵 ${first.title || first.desc || query}`);
    }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

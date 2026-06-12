const { apiFetch, sendMedia, safeUnsend } = require("../utils/mediaHelper");
module.exports = {
  config: { name: "flux", aliases: ["imagine", "img"], version: "1.0", role: 0, countDown: 20, category: "image", guide: { en: "{pn} <prompt> [ratio: 1:1|16:9|9:16]" } },
  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply("❌ أرسل وصف الصورة.\nمثال: .flux a sunset 16:9");
    const ratioRx = /^\d+:\d+$/;
    const ratio   = ratioRx.test(args.at(-1)) ? args.pop() : "1:1";
    const prompt  = args.join(" ");
    const wait    = await message.reply(`🎨 جارٍ توليد الصورة...\n"${prompt}" | ${ratio}`);
    try { await sendMedia(message, wait, await apiFetch("fluxpro", { prompt, ratio }), `🖼️ "${prompt}"`); }
    catch (e) { safeUnsend(message, wait); message.reply("❌ " + (e.response?.data?.error || e.message)); }
  }
};

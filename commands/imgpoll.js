"use strict";
/**
 * commands/imgpoll.js  —  توليد صور عبر Pollinations.ai
 * ──────────────────────────────────────────────────────────
 * BUG FIXED ①: كان config.name: "img" وهو نفس img.js → يتعارضان (الثاني يُلغي الأول).
 *              تم تغيير الاسم إلى "imgpoll" مع إضافة "img1" كـ alias.
 * BUG FIXED ②: كان يكتب الملفات في cache/ داخل المشروع (لا يُصلح على Render).
 *              تم تغييره إلى os.tmpdir() ويُحذف تلقائياً بعد الإرسال.
 */

const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");
const os    = require("os");
const { removeTempFile } = require("../utils/mediaUtils");

module.exports = {
  config: {
    name:             "imgpoll",
    aliases:          ["img1", "poll", "pollinations"],
    version:          "1.1.0",
    author:           "AI Assistant",
    countDown:        10,
    role:             0,
    shortDescription: { ar: "توليد الصور عبر Pollinations.ai" },
    category:         "وسائط",
    guide:            { ar: "{pn}imgpoll [وصف الصورة]" },
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID } = event;
    const prompt = args.join(" ").trim();

    if (!prompt) {
      return message.reply(
        "🎨 أمر توليد الصور (Pollinations)\n\n" +
        "📝 أمثلة:\n" +
        "• imgpoll قطة لطيفة\n" +
        "• imgpoll sunset over mountains"
      );
    }

    let imagePath = null;
    try {
      const enhancedPrompt = `${prompt}, high quality, detailed, 4k`;
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}` +
                       `?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;

      imagePath = path.join(os.tmpdir(), `imgpoll_${Date.now()}.jpg`);

      const response = await axios({
        method:       "GET",
        url:          imageUrl,
        responseType: "stream",
        timeout:      60000,
        headers:      { "User-Agent": "Mozilla/5.0" },
      });

      const contentType = response.headers["content-type"] || "";
      if (!contentType.startsWith("image/")) throw new Error("الخادم لم يُرجع صورة صالحة");

      const writer = fs.createWriteStream(imagePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        response.data.on("error", reject);
        setTimeout(() => reject(new Error("انتهت مهلة التحميل")), 60000);
      });

      const stats = await fs.stat(imagePath);
      if (stats.size < 1000) throw new Error("الصورة فارغة أو تالفة");

      await api.sendMessage(
        {
          body:       `✅ تم توليد الصورة!\n📝 الوصف: ${prompt}\n📦 الحجم: ${(stats.size / 1024 / 1024).toFixed(2)} MB`,
          attachment: fs.createReadStream(imagePath),
        },
        threadID, null, messageID
      );

    } catch (error) {
      let errMsg = "❌ فشل في توليد الصورة.\n";
      if (error.code === "ECONNABORTED" || error.message.includes("انتهت مهلة"))
        errMsg += "⏳ انتهت مهلة الاتصال. حاول بوصف أقصر.";
      else
        errMsg += `السبب: ${error.message?.substring(0, 100)}`;
      await message.reply(errMsg);
    } finally {
      await removeTempFile(imagePath);
    }
  },
};

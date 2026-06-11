const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

module.exports = {
  config: {
    name: "img",
    aliases: ["صورة", "تخيل", "ارسم", "draw", "imagine", "image", "generate"],
    version: "1.0.0",
    author: "AI Assistant",
    countDown: 10,
    role: 0,
    shortDescription: { ar: "توليد الصور من النص بالذكاء الاصطناعي" },
    category: "وسائط",
    guide: { ar: "{pn}img [وصف الصورة]" }
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID } = event;
    const prompt = args.join(" ").trim();

    if (!prompt) {
      return message.reply(
        "🎨 **أمر توليد الصور**\n\n" +
        "📝 اكتب وصفاً للصورة:\n" +
        "• img قطة لطيفة\n" +
        "• img sunset over mountains"
      );
    }

    const cacheDir = path.join(__dirname, '..', 'cache');
    if (!fs.existsSync(cacheDir)) fs.ensureDirSync(cacheDir);

    try {
      const enhancedPrompt = `${prompt}, high quality, detailed, 4k`;
      const encodedPrompt = encodeURIComponent(enhancedPrompt);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;

      const imagePath = path.join(cacheDir, `img_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`);

      const response = await axios({
        method: 'GET',
        url: imageUrl,
        responseType: 'stream',
        timeout: 60000,
        headers: { "User-Agent": "Mozilla/5.0" }
      });

      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        throw new Error("الخادم لم يُرجع صورة صالحة");
      }

      const writer = fs.createWriteStream(imagePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
        setTimeout(() => reject(new Error("انتهت مهلة التحميل")), 60000);
      });

      const stats = await fs.stat(imagePath);
      if (stats.size < 1000) throw new Error("الصورة فارغة أو تالفة");

      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      await api.sendMessage({
        body: `✅ تم توليد الصورة بنجاح!\n📝 الوصف: ${prompt}\n الحجم: ${sizeMB} MB`,
        attachment: fs.createReadStream(imagePath)
      }, threadID, null, messageID);

      fs.unlinkSync(imagePath);

    } catch (error) {
      console.error("[IMG Error]", error);
      let errMsg = "❌ فشل في توليد الصورة.\n";

      if (error.code === 'ECONNABORTED' || error.message.includes("انتهت مهلة")) {
        errMsg += "️ انتهت مهلة الاتصال. حاول بوصف أقصر.";
      } else {
        errMsg += `السبب: ${error.message}`;
      }

      await message.reply(errMsg);
    }
  }
};

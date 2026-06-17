"use strict";

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");
const yts   = require("yt-search"); // مكتبة البحث المحلية

const HF = (process.env.HF_SPACE_URL || "").replace(/\/+$/, "");

const EMOJIS = [
  ["1️⃣", "❶"], ["2️⃣", "❷"], ["3️⃣", "❸"], ["4️⃣", "❹"], ["5️⃣", "❺"],
  ["6️⃣", "❻"], ["7️⃣", "❼"], ["8️⃣", "❽"], ["9️⃣", "❾"], ["🔟", "❿"]
];

const YT_URL_RE = /(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|playlist\?list=)|youtu\.be\/)[\w\-]{5,}/;
function isYtUrl(s) {
  return YT_URL_RE.test(s);
}

module.exports = {
  config: {
    name: "yt",
    version: "6.0",
    author: "Heaventheif",
    cooldowns: 5,
    role: 0,
    shortDescription: "البحث والتحميل عبر Render + HF + CFW",
    longDescription: "يبحث محلياً عبر Render لتسريع القائمة، ثم يحمل عبر سيرفر HF والبروكسي.",
    category: "media",
    guide: "{p}yt <اسم المقطع أو الرابط>\nمثال: {p}yt سورة البقرة"
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID, senderID } = event;

    if (!HF) {
      return message.reply("❌ متغير البيئة HF_SPACE_URL غير مضاف في إعدادات Render.");
    }

    let query = args.join(" ").trim();

    if (!query && event.type === "message_reply") {
      query = (event.messageReply.body || "").trim();
    }

    if (!query) {
      return message.reply("⚠️ يرجى كتابة نص البحث أو وضع رابط مقطع يوتيوب.");
    }

    const { messageID: statusMsgId } = await message.reply("🔍 جاري البحث السريع...");

    const update = async (text) => {
      try { await api.editMessage(text, statusMsgId); } catch (e) {}
    };

    try {
      if (isYtUrl(query)) {
        await update("📥 تم رصد رابط مباشر! جاري معالجة واستخراج ملف الميديا الصوتي...");
        const fakeChosen = { url: query, title: "مقطع من رابط مباشر", author: "YouTube" };
        return await downloadAndSend({
          api, threadID, messageID, statusMsgId, update,
          chosen: fakeChosen, wantMp4: false, senderID
        });
      }

      // البحث المباشر والمحلي باستخدام مكتبة yt-search على سيرفر Render
      const searchResults = await yts(query);
      const videos = searchResults.videos.slice(0, 10);

      if (!videos || videos.length === 0) {
        return await update("❌ لم يتم العثور على أي نتائج مطابقة لهذا البحث.");
      }

      let replyBody = `🔎 نـتـائـج الـبـحـث عـن: (${query})\n════════════════════\n`;
      const cleanedResults = [];

      for (let i = 0; i < videos.length; i++) {
        const v = videos[i];
        
        cleanedResults.push({
          url: v.url, // نمرر الرابط الكامل مباشرة للباك-إند
          title: v.title,
          author: v.author.name,
          duration: v.timestamp
        });

        replyBody += `${EMOJIS[i][0]} ${v.title}\n👤 القناة: ${v.author.name} | ⏱️ ${v.timestamp}\n\n`;
      }

      replyBody += `════════════════════\n📥 أرسل [رقم المقطع] لتحميله كـ MP3.\n💡 أرسل [الرقم + mp4] لتحميله كـ فيديو.\n✨ مثال: 1 mp4`;

      await update(replyBody);

      if (global.Kagenou?.replies) {
        global.Kagenou.replies[statusMsgId] = {
          commandName: "yt",
          author: senderID,
          results: cleanedResults,
          statusMsgId: statusMsgId
        };
      }

      setTimeout(() => {
        if (global.Kagenou?.replies?.[statusMsgId]) delete global.Kagenou.replies[statusMsgId];
      }, 120000);

    } catch (error) {
      console.error(error);
      await update(`❌ فشل البحث: ${error.message || "خطأ غير متوقع"}`);
    }
  },

  onReply: async ({ api, event, Reply, message }) => {
    if (!Reply?.results || event.senderID !== Reply.author) return;

    const { threadID, messageID, senderID } = event;
    const parts = event.body?.trim().split(/\s+/) || [];
    const idx = parseInt(parts[0]) - 1;
    
    const wantMp4 = parts[1]?.toLowerCase() === "mp4"
      ? true
      : parts[1]?.toLowerCase() === "mp3"
        ? false
        : Reply.wantMp4 ?? false;

    if (isNaN(idx) || idx < 0 || idx >= Reply.results.length) {
      return message.reply(`❌ اختيار خاطئ! يرجى إرسال رقم صحيح من 1 إلى ${Reply.results.length}`);
    }

    const chosen = Reply.results[idx];
    const statusMsgId = Reply.statusMsgId;

    if (global.Kagenou?.replies?.[statusMsgId]) delete global.Kagenou.replies[statusMsgId];

    const update = async (text) => {
      try { await api.editMessage(text, statusMsgId); } catch (e) {}
    };

    await downloadAndSend({
      api, threadID, messageID, statusMsgId, update, chosen, wantMp4, senderID
    });
  }
};

async function downloadAndSend({ api, threadID, messageID, statusMsgId, update, chosen, wantMp4, senderID }) {
  const endpoint = wantMp4 ? "/yt/video" : "/yt/audio";
  const fileExt = wantMp4 ? "mp4" : "mp3";
  
  const tempFilePath = path.join(os.tmpdir(), `sunken_media_${Date.now()}_${senderID}.${fileExt}`);

  try {
    await update(`📥 جاري استخراج الميديا وتحميلها سحابياً...\nالصيغة الحالية: [ ${fileExt.toUpperCase()} ] ⏳`);

    // إرسال الرابط الكامل لـ HF ليبدأ yt-dlp المعالجة
    const response = await axios({
      method: "POST",
      url: `${HF}${endpoint}`,
      data: { url: chosen.url },
      responseType: "stream",
      timeout: 240000
    });

    await update(`⚡ تم الوصول للسيرفرات! جاري تنزيل الملف لتجهيز الرفع...`);

    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    const stats = await fs.stat(tempFilePath);
    if (stats.size < 1500) {
      const content = await fs.readFile(tempFilePath, "utf-8");
      if (content.includes("error") || content.startsWith("{")) {
        const errJson = JSON.parse(content);
        throw new Error(errJson.error || "فشل سيرفر الباك-إند في معالجة هذا المقطع.");
      }
    }

    await update("📤 جاري رفع الملف الآن إلى خوادم فيسبوك...");

    const msgToSend = {
      body: `🎵 تم التحميل بنجاح!\n\n📌 العنوان: ${chosen.title}\n👤 القناة: ${chosen.author}`,
      attachment: fs.createReadStream(tempFilePath)
    };

    await api.sendMessage(msgToSend, threadID, async (err) => {
      if (err) {
        await update(`❌ فشل إرسال الملف كمرفق (تأكد أن حجم المقطع لا يتجاوز 25MB).`);
      } else {
        try { await api.unsendMessage(statusMsgId); } catch (e) {}
      }
      try { await fs.unlink(tempFilePath); } catch (e) {}
    }, messageID);

  } catch (error) {
    console.error("خطأ في دورة عمل yt.js:", error);
    try { if (fs.existsSync(tempFilePath)) await fs.unlink(tempFilePath); } catch (e) {}
    await update(`❌ فشل التحميل:\n${error.message}`);
  }
}
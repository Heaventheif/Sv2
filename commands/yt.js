"use strict";
/**
 * yt.js v5.1 — النسخة المستقرة والمعدلة تلقائياً
 * ══════════════════════════════════════════════════════════════
 * تم حل مشكلة الـ 400 Bad Request عن طريق تحويل الـ ID تلقائياً إلى رابط كامل
 * ══════════════════════════════════════════════════════════════
 */

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

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
    version: "5.1",
    author: "Heaventheif",
    cooldowns: 5,
    role: 0,
    shortDescription: "البحث والتحميل من YouTube عبر السيرفر السحابي",
    longDescription: "يبحث في يوتيوب ويعرض قائمة نتائج، عند الرد برقم المقطع يتم تحميله كـ MP3 أو MP4 عبر سيرفر HF.",
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

    const { messageID: statusMsgId } = await message.reply("🔍 جاري فحص الطلب والاتصال بالسيرفر السحابis...");

    const update = async (text) => {
      try { await api.editMessage(text, statusMsgId); } catch (e) {}
    };

    try {
      if (isYtUrl(query)) {
        await update("📥 تم رصد رابط مباشر! جاري معالجة واستخراج ملف الميديا الصوتي...");
        const fakeChosen = { id: query, title: "مقطع من رابط مباشر", author: "YouTube" };
        return await downloadAndSend({
          api, threadID, messageID, statusMsgId, update,
          chosen: fakeChosen, wantMp4: false, senderID
        });
      }

      await update(`🚀 جاري البحث عن: "${query}"...`);

      const response = await axios.post(`${HF}/yt/search`, { query: query }, { timeout: 25000 });
      const results = response.data?.results || [];

      if (!results || results.length === 0) {
        return await update("❌ لم يتم العثور على أي نتائج مطابقة لهذا البحث.");
      }

      let replyBody = `🔎 نـتـائـج الـبـحـث عـن: (${query})\n════════════════════\n`;
      for (let i = 0; i < Math.min(results.length, 10); i++) {
        const item = results[i];
        replyBody += `${EMOJIS[i][0]} ${item.title}\n👤 القناة: ${item.author || "غير معروف"} | ⏱️ ${item.duration || "??:??"}\n\n`;
      }
      replyBody += `════════════════════\n📥 أرسل [رقم المقطع] لتحميله كـ MP3.\n💡 أرسل [الرقم + mp4] لتحميله كـ فيديو.\n✨ مثال: 1 mp4`;

      await update(replyBody);

      if (global.Kagenou?.replies) {
        global.Kagenou.replies[statusMsgId] = {
          commandName: "yt",
          author: senderID,
          results: results,
          statusMsgId: statusMsgId
        };
      }

      setTimeout(() => {
        if (global.Kagenou?.replies?.[statusMsgId]) delete global.Kagenou.replies[statusMsgId];
      }, 120000);

    } catch (error) {
      console.error(error);
      await update(`❌ فشل الاتصال بسيرفر الباك-إند: ${error.message || "خطأ غير متوقع"}`);
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
  
  // ✨ التعديل السحري هنا: تحويل الـ ID تلقائياً لرابط كامل ليقبله سيرفر بايثون
  let targetUrl = chosen.id; 
  if (targetUrl && !targetUrl.startsWith("http")) {
    targetUrl = `https://www.youtube.com/watch?v=${targetUrl}`;
  }
  
  const tempFilePath = path.join(os.tmpdir(), `sunken_media_${Date.now()}_${senderID}.${fileExt}`);

  try {
    await update(`📥 جاري استخراج الميديا وتحميلها على سيرفر HF السحابي...\nالصيغة الحالية: [ ${fileExt.toUpperCase()} ] ⏳`);

    const response = await axios({
      method: "POST",
      url: `${HF}${endpoint}`,
      data: { url: targetUrl },
      responseType: "stream",
      timeout: 240000
    });

    await update(`⚡ اكتمل الاستخراج السحابي! جاري كتابة الملف مؤقتاً لتجهيز الرفع...`);

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
      body: `🎵 تم التحميل بنجاح!\n\n📌 العنوان: ${chosen.title}\n👤 القناة: ${chosen.author || "YouTube"}`,
      attachment: fs.createReadStream(tempFilePath)
    };

    await api.sendMessage(msgToSend, threadID, async (err) => {
      if (err) {
        await update(`❌ فشل إرسال الملف كمرفق (قد يتجاوز 25MB حد فيسبوك).`);
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
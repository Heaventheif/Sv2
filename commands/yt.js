"use strict";

/**
 * yt.js v5.0 — النسخة الكاملة والثابتة لمنصة Render
 * ══════════════════════════════════════════════════════════════
 * متوافق تماماً وبدون أي تعديل على سيرفر بايثون (yt.py) أو الـ Worker (worker.js)
 * * التدفق المشترك:
 * 1. البحث: Render (yt.js) ── POST {"query"} ──> HF (yt.py) ──> CF Worker ──> YouTube
 * 2. التحميل: Render (yt.js) ── POST {"url"} ──> HF (yt.py) [يحمل ويحول عبر FFmpeg] ──> يعود كـ FileResponse لـ Render
 *
 * متغيرات البيئة المطلوبة في Render:
 * HF_SPACE_URL : رابط السيرفر في Hugging Face (مثال: https://user-space.hf.space)
 * ══════════════════════════════════════════════════════════════
 */

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

// جلب عنوان الـ Hugging Face Space وتنظيفه من الشرطات المائلة الزائدة
const HF = (process.env.HF_SPACE_URL || "").replace(/\/+$/, "");

// مصفوفة الرموز التعبيرية لعرض الأرقام (الرد بالنص أو عبر التفاعل)
const EMOJIS = [
  ["1️⃣", "❶"], ["2️⃣", "❷"], ["3️⃣", "❸"], ["4️⃣", "❹"], ["5️⃣", "❺"],
  ["6️⃣", "❻"], ["7️⃣", "❼"], ["8️⃣", "❽"], ["9️⃣", "❾"], ["🔟", "❿"]
];

// التعبير النمطي للتحقق من روابط يوتيوب المباشرة
const YT_URL_RE = /(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|playlist\?list=)|youtu\.be\/)[\w\-]{5,}/;
function isYtUrl(s) {
  return YT_URL_RE.test(s);
}

module.exports = {
  config: {
    name: "yt",
    version: "5.0",
    author: "Heaventheif",
    cooldowns: 5,
    role: 0,
    shortDescription: "البحث والتحميل من YouTube عبر السيرفر السحابي",
    longDescription: "يبحث في يوتيوب ويعرض قائمة نتائج، عند الرد برقم المقطع يتم تحميله كـ MP3 أو MP4 عبر سيرفر HF.",
    category: "media",
    guide: "{p}yt <اسم المقطع أو الرابط>\nمثال: {p}yt سورة البقرة\nللتحميل المباشر: {p}yt https://youtu.be/xxxx"
  },

  // ─────────────────────────────────────────────────────────────
  // 1. استقبال الأمر والبحث (onStart)
  // ─────────────────────────────────────────────────────────────
  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID, senderID } = event;

    if (!HF) {
      return message.reply("❌ متغير البيئة HF_SPACE_URL غير مضاف أو غير مضبوط في إعدادات Render.");
    }

    let query = args.join(" ").trim();

    // إذا لم يتم إدخال نص، تحقق مما إذا كان هناك رد على رسالة نصية أو رابط
    if (!query && event.type === "message_reply") {
      query = (event.messageReply.body || "").trim();
    }

    if (!query) {
      return message.reply("⚠️ يرجى كتابة نص البحث أو وضع رابط مقطع يوتيوب.");
    }

    // إرسال رسالة الحالة الأولى للمستخدم
    const { messageID: statusMsgId } = await message.reply("🔍 جاري فحص الطلب والاتصال بالسيرفر السحابي...");

    const update = async (text) => {
      try { await api.editMessage(text, statusMsgId); } catch (e) {}
    };

    try {
      // أ. في حال كان المدخل رابط مباشر (يتم التحميل فوري كـ صوت)
      if (isYtUrl(query)) {
        await update("📥 تم رصد رابط مباشر! جاري معالجة واستخراج ملف الميديا الصوتي...");
        const fakeChosen = { id: query, title: "مقطع من رابط مباشر", author: "YouTube" };
        
        return await downloadAndSend({
          api, threadID, messageID, statusMsgId, update,
          chosen: fakeChosen, wantMp4: false, senderID
        });
      }

      // ب. في حال كان المدخل نص بحث عادي
      await update(`🚀 جاري البحث عن: "${query}"...`);

      // إرسال طلب البحث إلى endpoint الـ search الخاص بـ yt.py
      const response = await axios.post(`${HF}/yt/search`, { query: query }, { timeout: 25000 });
      const results = response.data?.results || [];

      if (!results || results.length === 0) {
        return await update("❌ لم يتم العثور على أي نتائج مطابقة لهذا البحث.");
      }

      // بناء قائمة النتائج الـ 10 المعروضة للمستخدم
      let replyBody = `🔎 نـتـائـج الـبـحـث عـن: (${query})\n════════════════════\n`;
      for (let i = 0; i < Math.min(results.length, 10); i++) {
        const item = results[i];
        replyBody += `${EMOJIS[i][0]} ${item.title}\n👤 القناة: ${item.author || "غير معروف"} | ⏱️ ${item.duration || "??:??"}\n\n`;
      }
      replyBody += `════════════════════\n📥 أرسل [رقم المقطع] لتحميله كـ MP3 (صوت).\n💡 أرسل [الرقم + mp4] لتحميله كـ فيديو.\n✨ مثال: 1 mp4`;

      await update(replyBody);

      // تسجيل بيانات الجلسة في الذاكرة بانتظار رد المستخدم (الـ Reply)
      if (global.Kagenou?.replies) {
        global.Kagenou.replies[statusMsgId] = {
          commandName: "yt",
          author: senderID,
          results: results,
          statusMsgId: statusMsgId
        };
      }

      // نظام الاستماع للتفاعلات (Reaction) إن كان مدعوماً ببنيتك للتبسيط
      if (global.client?.reactionListener) {
        global.client.reactionListener[statusMsgId] = {
          commandName: "yt",
          author: senderID,
          results: results,
          statusMsgId: statusMsgId
        };
      }

      // تدمير الجلسة المؤقتة بعد دقيقتين في حال عدم الاستجابة منعاً لتراكم البيانات في الذاكرة
      setTimeout(() => {
        if (global.Kagenou?.replies?.[statusMsgId]) delete global.Kagenou.replies[statusMsgId];
        if (global.client?.reactionListener?.[statusMsgId]) delete global.client.reactionListener[statusMsgId];
      }, 120000);

    } catch (error) {
      console.error(error);
      await update(`❌ فشل الاتصال بسيرفر الباك-إند: ${error.message || "خطأ غير متوقع"}`);
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 2. معالجة اختيار رقم المقطع من قِبل المستخدم (onReply)
  // ─────────────────────────────────────────────────────────────
  onReply: async ({ api, event, Reply, message }) => {
    // التأكد من أن الذي رد هو نفس الشخص صاحب أمر البحث
    if (!Reply?.results || event.senderID !== Reply.author) return;

    const { threadID, messageID, senderID } = event;
    const parts = event.body?.trim().split(/\s+/) || [];
    const idx = parseInt(parts[0]) - 1;
    
    // فحص هل العضو طلب تحميل الفيديو (mp4) أم الصوت (mp3)
    const wantMp4 = parts[1]?.toLowerCase() === "mp4"
      ? true
      : parts[1]?.toLowerCase() === "mp3"
        ? false
        : Reply.wantMp4 ?? false;

    if (isNaN(idx) || idx < 0 || idx >= Reply.results.length) {
      return message.reply(`❌ اختيار خاطئ! يرجى إرسال رقم صحيح من 1 إلى ${Reply.results.length}\nمثال للتحميل كـ فيديو: 2 mp4`);
    }

    const chosen = Reply.results[idx];
    const statusMsgId = Reply.statusMsgId;

    // حذف مستمعات الرد فوراً لمنع التداخل والتكرار عند نقر المستخدم مرتين
    if (global.client?.reactionListener?.[statusMsgId]) delete global.client.reactionListener[statusMsgId];
    if (global.Kagenou?.replies?.[statusMsgId]) delete global.Kagenou.replies[statusMsgId];

    const update = async (text) => {
      try { await api.editMessage(text, statusMsgId); } catch (e) {}
    };

    // استدعاء الدالة التنفيذية للتحميل والإرسال
    await downloadAndSend({
      api, threadID, messageID, statusMsgId, update, chosen, wantMp4, senderID
    });
  }
};

// ─────────────────────────────────────────────────────────────
// 3. دالة التحميل التدفقي من HF وحفظها بـ Render ثم رفعها لفيسبوك
// ─────────────────────────────────────────────────────────────
async function downloadAndSend({ api, threadID, messageID, statusMsgId, update, chosen, wantMp4, senderID }) {
  // توجيه الطلب للـ endpoint الصحيح المتوقع داخل yt.py
  const endpoint = wantMp4 ? "/yt/video" : "/yt/audio";
  const fileExt = wantMp4 ? "mp4" : "mp3";
  
  // دالة yt.py تستقبل الرابط الكامل أو الـ ID كمدخل مرسل في جسم الـ POST {"url": "..."}
  const targetUrl = chosen.id; 
  
  // إنشاء مسار آمن للملف المؤقت داخل مجلد الـ Temp في نظام تشغيل سيرفر Render
  const tempFilePath = path.join(os.tmpdir(), `sunken_media_${Date.now()}_${senderID}.${fileExt}`);

  try {
    await update(`📥 جاري استخراج الميديا وتحميلها على سيرفر HF السحابي...\nالصيغة الحالية: [ ${fileExt.toUpperCase()} ] ⏳\nيرجى الانتظار، قد يستغرق الأمر دقيقة...`);

    // إرسال الطلب لـ yt.py واستقبال الملف كـ مجرى تدفقي (stream) لتفادي استهلاك الرام في Render
    const response = await axios({
      method: "POST",
      url: `${HF}${endpoint}`,
      data: { url: targetUrl },
      responseType: "stream",
      timeout: 240000 // مهلة 4 دقائق كاملة للمقاطع الطويلة وعمليات معالجة ffmpeg الثقيلة
    });

    await update(`⚡ اكتمل الاستخراج السحابي! جاري كتابة الملف مؤقتاً لتجهيز الرفع لفيسبوك...`);

    // إنشاء مجرى حفظ الملف وكتابته على قرص Render
    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // فحص أمان أولي للتأكد من أن الـ response المُستلم هو ملف ميديا وليس نص خطأ json مخفي
    const stats = await fs.stat(tempFilePath);
    if (stats.size < 1500) { // الأحجام الأقل من 1.5 كيلوبايت تشير غالباً إلى رسالة خطأ نصية
      const content = await fs.readFile(tempFilePath, "utf-8");
      if (content.includes("error") || content.startsWith("{")) {
        const errJson = JSON.parse(content);
        throw new Error(errJson.error || "فشل سيرفر الباك-إند في معالجة وتحويل هذا المقطع.");
      }
    }

    await update("📤 جاري رفع الملف الصوتي/المرئي الآن إلى خوادم فيسبوك...");

    // تجهيز كائن الرسالة والمرفق التنفيذي الموجه لـ fca
    const msgToSend = {
      body: `🎵 تم التحميل بنجاح عبر النظام السحابي!\n\n📌 العنوان: ${chosen.title}\n👤 القناة: ${chosen.author || "YouTube"}\nالصيغة العائدة: ${fileExt.toUpperCase()}`,
      attachment: fs.createReadStream(tempFilePath)
    };

    // إرسال الملف الفعلي للمستخدم داخل شات فيسبوك ماسنجر
    await api.sendMessage(msgToSend, threadID, async (err) => {
      if (err) {
        console.error("خطأ رفع المرفق إلى فيسبوك:", err);
        await update(`❌ فشل إرسال الملف كمرفق.\n💡 السبب الشائع: حجم المقطع كبير جداً ويتجاوز الحد الأقصى المسموح به من فيسبوك للمطورين (25MB).`);
      } else {
        // تنظيف وحذف رسالة الانتظار التراكمية عند إتمام النجاح بنجاح
        try { await api.unsendMessage(statusMsgId); } catch (e) {}
      }
      
      // التنظيف الفوري الإلزامي لقرص Render فور إتمام الإرسال أو الفشل لحماية الحاوية من الامتلاء
      try { await fs.unlink(tempFilePath); } catch (e) {}
    }, messageID);

  } catch (error) {
    console.error("خطأ في دورة عمل yt.js:", error);
    
    // تنظيف وحذف الملف المؤقت إن وجد عند حدوث الانهيار المفاجئ
    try { if (fs.existsSync(tempFilePath)) await fs.unlink(tempFilePath); } catch (e) {}
    
    let errMsg = "تعذر تحميل المقطع بسبب مهلة الاتصال أو مشكلة في استجابة السيرفر.";
    if (error.response?.data) {
      errMsg = `خطأ السيرفر السحابي: ${error.message}`;
    } else {
      errMsg = error.message || errMsg;
    }
    await update(`❌ فشل التحميل:\n${errMsg}`);
  }
}
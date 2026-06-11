const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const sessionsDir = path.join(__dirname, '..', 'cache', 'ai2_sessions');
fs.ensureDirSync(sessionsDir);

// استخدم نموذج يدعم الرؤية إذا كان متاحاً، وإلا استخدم النصي
const VISION_MODEL = "llama-3.2-11b-vision-preview";
const TEXT_MODEL = "llama-3.3-70b-versatile";
let USE_VISION = true; // حاول استخدام الرؤية أولاً

const SYSTEM_INSTRUCTION = `أنت بوت مساعد ذكي على فيسبوك ماسنجر اسمك "Sunken". أجب دائماً باللغة العربية الفصحى البسيطة، اجعل ردودك مختصرة (أقل من 200 كلمة)، لا تذكر أنك نموذج ذكاء اصطناعي، كن ودوداً ومهذباً. إذا أرسلت لك صورة، حللها وصفها بدقة.`;

const groqClient = axios.create({
  baseURL: 'https://api.groq.com/openai/v1',
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${GROQ_API_KEY}`
  }
});

// دالة آمنة لتعيين التفاعل
const setReaction = (api, reaction, messageID, threadID) => {
  try {
    if (!reaction || !messageID || !threadID) return;
    if (String(messageID) === "undefined" || String(threadID) === "undefined") return;
    api.setMessageReaction(reaction, messageID, (err) => {
      if (err) console.error("[GROQ] فشل تعيين التفاعل:", err.message);
    }, true);
  } catch (e) {}
};

// تحميل ملف (صورة) وتحويله إلى Base64
async function fetchImageAsBase64(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const base64 = Buffer.from(response.data).toString('base64');
    const mimeType = response.headers['content-type'] || 'image/jpeg';
    return { base64, mimeType };
  } catch (err) {
    throw new Error(`فشل تحميل الصورة: ${err.message}`);
  }
}

// بناء محتوى الرسالة مع دعم الصور
async function buildGroqMessages(context, userPrompt, attachments) {
  const messages = [{ role: "system", content: SYSTEM_INSTRUCTION }];
  
  // إضافة السياق السابق
  for (const msg of context) {
    messages.push({ role: msg.role, content: msg.content });
  }
  
  // بناء محتوى المستخدم الحالي
  let userContent = [];
  
  // إضافة النص إن وجد
  if (userPrompt && userPrompt.trim()) {
    userContent.push({ type: "text", text: userPrompt.trim() });
  }
  
  // إضافة الصور المرفقة
  for (const att of attachments) {
    const type = (att.type || "").toLowerCase();
    const imgUrl = att.largePreviewUrl || att.url || att.previewUrl;
    if ((type === "photo" || type === "image" || (att.name && att.name.match(/\.(jpg|jpeg|png|gif|webp)$/i))) && imgUrl) {
      try {
        const { base64, mimeType } = await fetchImageAsBase64(imgUrl);
        userContent.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64}`
          }
        });
      } catch (err) {
        console.error("[GROQ] فشل تحميل الصورة:", err.message);
        userContent.push({ type: "text", text: `[صورة لم يتم تحميلها: ${err.message}]` });
      }
    } else if (type === "audio") {
      userContent.push({ type: "text", text: "[ملف صوتي مرفق]" });
    } else if (type === "video") {
      userContent.push({ type: "text", text: "[فيديو مرفق]" });
    } else if (att.url) {
      userContent.push({ type: "text", text: `[مرفق: ${type || "ملف"}]` });
    }
  }
  
  if (userContent.length === 0) {
    userContent.push({ type: "text", text: "." });
  }
  
  messages.push({ role: "user", content: userContent });
  return messages;
}

// استدعاء Groq API مع إعادة المحاولة التلقائية
async function callGroqWithRetry(messages, retries = 2) {
  let lastError = null;
  let currentModel = USE_VISION ? VISION_MODEL : TEXT_MODEL;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const payload = {
        model: currentModel,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 0.9
      };
      
      const response = await groqClient.post('/chat/completions', payload);
      const reply = response.data.choices?.[0]?.message?.content;
      if (reply) return reply;
      throw new Error("استجابة فارغة");
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const errorMsg = err.response?.data?.error?.message || err.message;
      
      if (status === 429) {
        console.warn("[GROQ] تجاوز الحد، انتظر 3 ثوان...");
        await new Promise(r => setTimeout(r, 3000));
        continue;
      } else if (status === 400 && errorMsg.includes("vision") && USE_VISION) {
        // النموذج البصري غير متاح، ننتقل إلى النصي
        console.warn("[GROQ] النموذج البصري فشل، ننتقل إلى النموذج النصي");
        USE_VISION = false;
        currentModel = TEXT_MODEL;
        continue;
      } else {
        console.error(`[GROQ] خطأ (${status}):`, errorMsg);
        if (attempt === retries - 1) throw err;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  throw lastError || new Error("فشلت جميع محاولات Groq");
}

module.exports = {
  config: {
    name: "groq",
    aliases: ["llama", "ai2", "ذكاء"],
    version: "3.2.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "محادثة مع Llama (يدعم الصور)" },
    category: "ذكاء اصطناعي",
    guide: {
      ar: "📌 `.groq سؤالك`\n📌 `.groq` مع صورة مرفقة\n📌 `.groq clear` لمسح الذاكرة"
    }
  },
  
  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID, senderID } = event;
    let prompt = args.join(" ").trim();
    
    // إذا كان رداً على رسالة وليس هناك نص، خذ نص الرسالة المقتبسة
    if (event.messageReply && !prompt) {
      prompt = event.messageReply.body || "";
    }
    
    const attachments = event.attachments || [];
    const replyAttachments = event.messageReply?.attachments || [];
    const allAttachments = [...attachments, ...replyAttachments];
    
    // أمر مسح الذاكرة
    if (prompt.toLowerCase() === "clear" || prompt === "مسح") {
      const userSession = path.join(sessionsDir, `${senderID}.json`);
      if (await fs.pathExists(userSession)) await fs.unlink(userSession);
      return api.sendMessage("🧹 تم مسح ذاكرة المحادثة الخاصة بك.", threadID, null, messageID);
    }
    
    if (!prompt && allAttachments.length === 0) {
      return api.sendMessage(
        "🤖 **Groq AI (Llama)**\n\n📝 أرسل سؤالك أو صورة مع الأمر\n💡 مثال: `.groq ما محتوى هذه الصورة؟`\n🖼️ يمكنك إرفاق صورة وسأقوم بتحليلها.",
        threadID, null, messageID
      );
    }
    
    if (!GROQ_API_KEY) {
      return api.sendMessage("❌ مفتاح GROQ_API_KEY غير موجود في البيئة.", threadID, null, messageID);
    }
    
    setReaction(api, "⏳", messageID, threadID);
    
    // تحميل السياق
    const userSession = path.join(sessionsDir, `${senderID}.json`);
    let context = [];
    try {
      if (await fs.pathExists(userSession)) {
        context = await fs.readJson(userSession);
        if (context.length > 12) context = context.slice(-12);
      }
    } catch (e) { context = []; }
    
    try {
      // بناء الرسائل
      const messages = await buildGroqMessages(context, prompt, allAttachments);
      
      // استدعاء API
      const reply = await callGroqWithRetry(messages);
      
      if (!reply) throw new Error("استجابة فارغة");
      
      setReaction(api, "✅", messageID, threadID);
      
      // إرسال الرد
      api.sendMessage(reply, threadID, async (err, info) => {
        if (err) {
          console.error("[GROQ] فشل الإرسال:", err.message);
          return;
        }
        // تسجيل الرد للمتابعة
        if (global.GoatBot && global.GoatBot.onReply) {
          global.GoatBot.onReply.set(info.messageID, {
            commandName: "groq",
            messageID: info.messageID,
            author: senderID,
            threadID: threadID
          });
        }
      }, messageID);
      
      // حفظ السياق الجديد
      let userContentText = prompt || (allAttachments.length ? "[مرفق]" : ".");
      context.push({ role: "user", content: userContentText });
      context.push({ role: "assistant", content: reply });
      if (context.length > 20) context = context.slice(-20);
      await fs.writeJson(userSession, context, { spaces: 0 }).catch(() => {});
      
    } catch (err) {
      setReaction(api, "❌", messageID, threadID);
      let errMsg = "❌ حدث خطأ: ";
      if (err.response?.status === 429) errMsg += "تم تجاوز الحد الأقصى للطلبات، انتظر قليلاً.";
      else if (err.response?.status === 401) errMsg += "مفتاح API غير صالح.";
      else if (err.code === 'ECONNABORTED') errMsg += "انتهت مهلة الاتصال.";
      else errMsg += err.message || "فشل الاتصال";
      api.sendMessage(errMsg, threadID, null, messageID);
    }
  },
  
  onReply: async ({ api, event, message }) => {
    const { threadID, messageID, senderID, body, attachments } = event;
    const Reply = event?.Reply || {};
    if (Reply.author !== senderID) return;
    
    let prompt = body.trim();
    
    // أمر مسح الذاكرة
    if (prompt.toLowerCase() === "clear" || prompt === "مسح") {
      const userSession = path.join(sessionsDir, `${senderID}.json`);
      if (await fs.pathExists(userSession)) await fs.unlink(userSession);
      return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
    }
    
    if (!GROQ_API_KEY) {
      return api.sendMessage("❌ مفتاح GROQ_API_KEY غير موجود.", threadID, null, messageID);
    }
    
    setReaction(api, "⏳", messageID, threadID);
    
    const userSession = path.join(sessionsDir, `${senderID}.json`);
    let context = [];
    try {
      if (await fs.pathExists(userSession)) {
        context = await fs.readJson(userSession);
        if (context.length > 12) context = context.slice(-12);
      }
    } catch (e) { context = []; }
    
    try {
      const messages = await buildGroqMessages(context, prompt, attachments || []);
      const reply = await callGroqWithRetry(messages);
      
      if (!reply) throw new Error("استجابة فارغة");
      
      setReaction(api, "✅", messageID, threadID);
      
      api.sendMessage(reply, threadID, async (err, info) => {
        if (err) return;
        if (global.GoatBot && global.GoatBot.onReply) {
          global.GoatBot.onReply.set(info.messageID, {
            commandName: "groq",
            messageID: info.messageID,
            author: senderID,
            threadID: threadID
          });
        }
      }, messageID);
      
      context.push({ role: "user", content: prompt });
      context.push({ role: "assistant", content: reply });
      if (context.length > 20) context = context.slice(-20);
      await fs.writeJson(userSession, context, { spaces: 0 }).catch(() => {});
      
    } catch (err) {
      setReaction(api, "❌", messageID, threadID);
      let errMsg = "❌ خطأ: ";
      if (err.response?.status === 429) errMsg += "تم تجاوز الحد، انتظر.";
      else errMsg += err.message || "فشل الاتصال";
      api.sendMessage(errMsg, threadID, null, messageID);
    }
  }
};

const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) console.error("[GROQ] ⚠️ GROQ_API_KEY غير موجود في .env");

const sessionsDir = path.join(__dirname, "..", "cache", "groq_sessions");
fs.ensureDirSync(sessionsDir);

// نموذج يدعم الصور (vision)
const VISION_MODEL = "llama-3.2-11b-vision-preview";
// نموذج احتياطي نصي
const TEXT_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_INSTRUCTION = `أنت بوت مساعد ذكي على فيسبوك ماسنجر اسمك "Sunken". أجب دائماً باللغة العربية الفصحى البسيطة، اجعل ردودك مختصرة (أقل من 200 كلمة)، لا تذكر أنك نموذج ذكاء اصطناعي، كن ودوداً ومهذباً.`;

const groqClient = axios.create({
  baseURL: "https://api.groq.com/openai/v1",
  timeout: 20000,
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${GROQ_API_KEY}`
  }
});

// تحويل الصورة إلى Base64 URL
async function imageToDataUrl(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const base64 = Buffer.from(response.data).toString("base64");
    const mime = response.headers["content-type"] || "image/jpeg";
    return `data:${mime};base64,${base64}`;
  } catch (err) {
    throw new Error(`فشل تحميل الصورة: ${err.message}`);
  }
}

async function buildGroqMessages(prompt, attachments, history) {
  const messages = [{ role: "system", content: SYSTEM_INSTRUCTION }];
  
  // إضافة التاريخ
  for (const h of history) {
    messages.push({
      role: h.role === "user" ? "user" : "assistant",
      content: h.content
    });
  }

  // بناء محتوى المستخدم (نص + صور)
  let userContent = prompt || "";
  const imageUrls = [];

  for (const att of attachments) {
    const type = (att.type || "").toLowerCase();
    const imgUrl = att.largePreviewUrl || att.url || att.previewUrl;
    if ((type === "photo" || type === "image") && imgUrl) {
      imageUrls.push(imgUrl);
    }
  }

  // إذا توجد صور، استخدم النموذج البصري
  if (imageUrls.length > 0) {
    // تحويل الصور إلى Base64 مسبقاً (مطلوب للنموذج البصري)
    const contentParts = [];
    if (userContent) contentParts.push({ type: "text", text: userContent });
    
    for (const url of imageUrls) {
      try {
        const dataUrl = await imageToDataUrl(url);
        contentParts.push({
          type: "image_url",
          image_url: { url: dataUrl }
        });
      } catch (err) {
        contentParts.push({ type: "text", text: `[فشل تحميل صورة: ${err.message}]` });
      }
    }
    messages.push({ role: "user", content: contentParts });
    return { messages, useVision: true };
  } else {
    // نص فقط
    messages.push({ role: "user", content: userContent || "." });
    return { messages, useVision: false };
  }
}

async function callGroqWithFallback(messages, useVision) {
  // أولاً: جرب النموذج البصري إذا كان مطلوباً
  if (useVision) {
    try {
      const response = await groqClient.post("/chat/completions", {
        model: VISION_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 0.9,
        stream: false
      });
      const reply = response.data.choices?.[0]?.message?.content;
      if (reply) return reply;
    } catch (err) {
      const status = err.response?.status;
      const errorMsg = err.response?.data?.error?.message || err.message;
      console.error(`[GROQ] فشل النموذج البصري (${status}): ${errorMsg}`);
      if (status === 403) {
        throw new Error("مفتاح Groq غير صالح أو محظور (403)");
      }
      // إذا كان الخطأ بسبب عدم دعم الصور، نجرب النصي
      if (errorMsg.includes("vision") || errorMsg.includes("image")) {
        console.warn("[GROQ] النموذج البصري لا يعمل، جرب النصي بدون صور");
        // نزيل الصور ونرسل النص فقط
        const textOnlyMessages = messages.map(m => {
          if (m.role === "user" && Array.isArray(m.content)) {
            const textPart = m.content.find(p => p.type === "text");
            return { ...m, content: textPart?.text || "." };
          }
          return m;
        });
        const response = await groqClient.post("/chat/completions", {
          model: TEXT_MODEL,
          messages: textOnlyMessages,
          temperature: 0.7,
          max_tokens: 2048,
          top_p: 0.9
        });
        const reply = response.data.choices?.[0]?.message?.content;
        if (reply) return reply;
        throw new Error("لا رد من النموذج النصي");
      }
      throw err;
    }
  } else {
    // استخدام النموذج النصي مباشرة
    const response = await groqClient.post("/chat/completions", {
      model: TEXT_MODEL,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2048,
      top_p: 0.9
    });
    const reply = response.data.choices?.[0]?.message?.content;
    if (!reply) throw new Error("استجابة فارغة");
    return reply;
  }
}

async function handleMessage(api, event, promptText, attachments) {
  const { threadID, messageID, senderID } = event;

  if (promptText && (promptText.toLowerCase() === "clear" || promptText === "مسح")) {
    const sessionPath = path.join(sessionsDir, `${senderID}.json`);
    try { await fs.unlink(sessionPath); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  if (!promptText.trim() && !attachments.length) {
    return api.sendMessage("🤖 **Groq AI**\nأرسل سؤالك أو صورة.\nمثال: `.groq ما هذه الصورة؟`", threadID, null, messageID);
  }

  if (!GROQ_API_KEY) {
    return api.sendMessage("❌ مفتاح GROQ_API_KEY غير موجود في البيئة.", threadID, null, messageID);
  }

  // تحميل سياق المستخدم
  const sessionPath = path.join(sessionsDir, `${senderID}.json`);
  let history = [];
  try {
    if (await fs.pathExists(sessionPath)) history = await fs.readJson(sessionPath);
  } catch (_) {}
  if (history.length > 20) history = history.slice(-20);

  const { messages, useVision } = await buildGroqMessages(promptText, attachments, history);

  try {
    const reply = await callGroqWithFallback(messages, useVision);
    
    // إرسال الرد
    api.sendMessage(reply, threadID, (err, info) => {
      if (!err && info && global.GoatBot && global.GoatBot.onReply) {
        global.GoatBot.onReply.set(info.messageID, {
          commandName: "groq",
          messageID: info.messageID,
          author: senderID,
          threadID: threadID
        });
      }
    }, messageID);

    // حفظ التاريخ (بصيغة نصية فقط لتوفير المساحة)
    const userText = promptText || (attachments.length ? "[صورة]" : ".");
    history.push({ role: "user", content: userText });
    history.push({ role: "assistant", content: reply });
    await fs.writeJson(sessionPath, history.slice(-20), { spaces: 0 });
  } catch (err) {
    const status = err.response?.status;
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error("[GROQ] خطأ:", status, errorMsg);
    let userMsg = "❌ حدث خطأ: ";
    if (status === 403) userMsg += "مفتاح Groq غير صالح أو محظور. تأكد من صحة GROQ_API_KEY.";
    else if (status === 429) userMsg += "تم تجاوز حد الاستخدام، انتظر قليلاً.";
    else if (err.code === "ECONNABORTED") userMsg += "انتهت مهلة الاتصال.";
    else userMsg += errorMsg;
    api.sendMessage(userMsg, threadID, null, messageID);
  }
}

module.exports = {
  config: {
    name: "groq",
    aliases: ["llama", "ai2", "جروك"],
    version: "3.5.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "محادثة مع Llama (يدعم الصور)" },
    category: "ذكاء اصطناعي",
    guide: { ar: ".groq سؤالك\n.groq مع صورة\n.groq clear" }
  },
  onStart: async ({ api, event, args }) => {
    const text = args.join(" ").trim();
    const attachments = event.attachments || [];
    const replyAttachments = event.messageReply?.attachments || [];
    const finalText = text || event.messageReply?.body || "";
    await handleMessage(api, event, finalText, [...attachments, ...replyAttachments]);
  },
  onReply: async ({ api, event }) => {
    const text = event.body?.trim() || "";
    const attachments = event.attachments || [];
    await handleMessage(api, event, text, attachments);
  }
};
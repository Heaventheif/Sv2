const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(k => k && k.length > 10);

const GROQ_API_KEY = process.env.GROQ_API_KEY;

let keyIndex = 0;
const getNextKey = () => {
  if (!GEMINI_KEYS.length) return null;
  const k = GEMINI_KEYS[keyIndex];
  keyIndex = (keyIndex + 1) % GEMINI_KEYS.length;
  return k;
};

const sessionsDir = path.join(__dirname, "..", "cache", "ai_sessions");
fs.ensureDirSync(sessionsDir);

const getSessionPath = (tid) => path.join(sessionsDir, `thread_${tid}.json`);

async function loadSession(tid) {
  try {
    if (await fs.pathExists(getSessionPath(tid))) {
      return await fs.readJson(getSessionPath(tid));
    }
  } catch (_) {}
  return [];
}

async function saveSession(tid, ctx) {
  try {
    await fs.writeJson(getSessionPath(tid), ctx.slice(-10), { spaces: 0 });
  } catch (_) {}
}

const SYSTEM_INSTRUCTION = `أنت بوت مساعد ذكي على فيسبوك ماسنجر اسمك "Sunken".
- أجب بإيجاز باللغة العربية (أقل من 200 كلمة).
- إذا أُرسلت لك صورة، حللها وصفها بدقة.
- كن ودوداً ومهذباً ومفيداً.`;

// تحميل ملف (صورة أو صوت) وتحويله إلى Base64
async function fetchAndConvertToBase64(url, fallbackMime = "image/jpeg") {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const base64 = Buffer.from(response.data).toString("base64");
    const mimeType = response.headers["content-type"] || fallbackMime;
    return { base64, mimeType };
  } catch (err) {
    throw new Error(`فشل التحميل: ${err.message}`);
  }
}

async function buildParts(text, attachments) {
  const parts = [];
  if (text && text.trim()) parts.push({ text: text.trim() });

  for (const att of attachments) {
    const type = (att.type || "").toLowerCase();
    // استخدم أفضل رابط متاح
    const mediaUrl = att.largePreviewUrl || att.url || att.previewUrl;
    if (!mediaUrl) continue;

    if (type === "photo" || type === "image" || (att.name && att.name.match(/\.(jpg|jpeg|png|gif|webp)$/i))) {
      try {
        const { base64, mimeType } = await fetchAndConvertToBase64(mediaUrl, "image/jpeg");
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64
          }
        });
      } catch (err) {
        console.error("[GEMINI] فشل تحميل الصورة:", err.message);
        parts.push({ text: `[تعذر تحميل الصورة: ${err.message}]` });
      }
    } 
    else if (type === "audio") {
      try {
        const { base64, mimeType } = await fetchAndConvertToBase64(mediaUrl, "audio/mpeg");
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64
          }
        });
      } catch (err) {
        console.error("[GEMINI] فشل تحميل الصوت:", err.message);
        parts.push({ text: "[ملف صوتي - تعذر التحميل]" });
      }
    }
    else if (type === "video") {
      parts.push({ text: "[فيديو مرفق - لا يمكن معالجته حالياً]" });
    }
    else {
      parts.push({ text: `[مرفق: ${type || "ملف"}]` });
    }
  }

  return parts.length > 0 ? parts : [{ text: "." }];
}

async function callGemini(contents, apiKey) {
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      topP: 0.95
    }
  };

  const response = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    payload,
    {
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey
      }
    }
  );

  const candidate = response.data.candidates?.[0];
  if (!candidate) throw new Error("لا يوجد مرشح في الرد");
  const text = candidate.content?.parts?.[0]?.text;
  if (!text) throw new Error("استجابة فارغة من Gemini");
  return text;
}

async function callGeminiWithRetry(contents) {
  if (!GEMINI_KEYS.length) throw new Error("لا توجد مفاتيح Gemini متاحة");

  // نسخة من المفاتيح لنحاول بها بشكل دائري مع تأخير
  const triedKeys = [];
  for (let attempt = 0; attempt < GEMINI_KEYS.length * 2; attempt++) {
    const key = getNextKey();
    if (!key) break;
    if (triedKeys.includes(key)) continue;
    triedKeys.push(key);

    try {
      const reply = await callGemini(contents, key);
      if (reply) return reply;
    } catch (err) {
      const status = err.response?.status;
      const errorMsg = err.response?.data?.error?.message || err.message;

      if (status === 429) {
        console.warn(`[GEMINI] مفتاح (${triedKeys.length}) تجاوز الحد → تأخير 3 ثوان ثم تجربة مفتاح آخر`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      } else if (status === 400 && errorMsg.includes("location")) {
        console.error("[GEMINI] خطأ 400: مشكلة في المنطقة الجغرافية. قد يحتاج المفتاح إلى تفعيل الفوترة.");
        continue;
      } else if (status === 403) {
        console.error("[GEMINI] مفتاح غير مصرح به (403). تحقق من صلاحياته.");
        continue;
      } else {
        console.error(`[GEMINI] خطأ غير متوقع (${status || 'network'}):`, errorMsg);
        // إذا كان خطأ ليس 429، قد يكون المفتاح تالفاً، ننتقل للمفتاح التالي
        continue;
      }
    }
  }
  throw new Error("جميع مفاتيح Gemini فشلت (429 أو أخطاء أخرى)");
}

async function callGroq(contents) {
  if (!GROQ_API_KEY) throw new Error("لا يوجد مفتاح Groq");

  // تحويل محتويات Gemini إلى رسائل Groq
  const messages = [
    { role: "system", content: SYSTEM_INSTRUCTION }
  ];

  for (const c of contents) {
    const role = c.role === "model" ? "assistant" : "user";
    let contentText = "";
    for (const part of c.parts) {
      if (part.text) contentText += part.text + " ";
      else if (part.inlineData) contentText += "[صورة مرفقة] ";
      else if (part.fileData) contentText += "[مرفق] ";
    }
    messages.push({ role, content: contentText.trim() || "[مرفق]" });
  }

  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.3-70b-versatile",
      messages: messages,
      temperature: 0.7,
      max_tokens: 2048,
      top_p: 0.9
    },
    {
      timeout: 20000,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      }
    }
  );

  const reply = response.data.choices?.[0]?.message?.content;
  if (!reply) throw new Error("استجابة فارغة من Groq");
  return reply;
}

async function handleMessage(api, event, promptText, attachments) {
  const { threadID, messageID, senderID } = event;

  // أمر مسح الذاكرة
  if (promptText && (promptText.toLowerCase() === "clear" || promptText === "مسح")) {
    try {
      await fs.unlink(getSessionPath(threadID));
    } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  if (!promptText.trim() && !attachments.length) {
    return api.sendMessage(
      "🤖 **Sunken AI**\n\n📝 أرسل سؤالك أو صورة مع الأمر\n💡 مثال: `.gemini ما هذه الصورة؟`\n🖼️ يمكنك إرفاق صورة وسأحللها لك.",
      threadID, null, messageID
    );
  }

  // تحميل سياق المحادثة
  let context = await loadSession(threadID);
  const newParts = await buildParts(promptText, attachments);
  const contents = [...context, { role: "user", parts: newParts }];

  let reply = null;
  let usedGroq = false;

  try {
    reply = await callGeminiWithRetry(contents);
  } catch (geminiErr) {
    console.warn("[GEMINI] فشلت كل محاولات Gemini:", geminiErr.message);
    if (GROQ_API_KEY) {
      try {
        reply = await callGroq(contents);
        usedGroq = true;
      } catch (groqErr) {
        console.error("[GROQ] فشل:", groqErr.message);
        return api.sendMessage("❌ جميع محاولات الذكاء الاصطناعي فشلت. حاول لاحقاً.", threadID, null, messageID);
      }
    } else {
      return api.sendMessage("❌ خدمة Gemini غير متاحة حالياً (جميع المفاتيح تجاوزت الحد).", threadID, null, messageID);
    }
  }

  if (!reply) {
    return api.sendMessage("❌ لم أستطع توليد رد. حاول مجدداً.", threadID, null, messageID);
  }

  // إرسال الرد
  api.sendMessage(reply, threadID, (err, info) => {
    if (!err && info && global.GoatBot && global.GoatBot.onReply) {
      global.GoatBot.onReply.set(info.messageID, {
        commandName: "gemini",
        messageID: info.messageID,
        author: senderID,
        threadID: threadID,
      });
    }
  }, messageID);

  // حفظ السياق (بدون الصور الكبيرة)
  const userText = promptText || (attachments.length ? "[مرفق]" : ".");
  await saveSession(threadID, [
    ...context.slice(-8),
    { role: "user", parts: [{ text: userText }] },
    { role: "model", parts: [{ text: reply }] }
  ]);
}

module.exports = {
  config: {
    name: "gemini",
    aliases: ["بوت", "ai", "gm", "جيميني"],
    version: "3.3.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    shortDescription: { ar: "محادثة ذكية تدعم الصور والصوت" },
    category: "ذكاء اصطناعي",
    guide: {
      ar: "📌 `.gemini سؤالك`\n📌 `.gemini` مع صورة مرفقة\n📌 `.gemini clear` لمسح الذاكرة"
    }
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

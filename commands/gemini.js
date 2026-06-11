"use strict";
const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");

// ─── المفاتيح ────────────────────────────────────────────────
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(k => k && k.trim().length > 10);

const GROQ_KEY = process.env.GROQ_API_KEY;

// ─── الجلسات ─────────────────────────────────────────────────
const sessionsDir = path.join(__dirname, "..", "cache", "gemini_sessions");
fs.ensureDirSync(sessionsDir);
const sessionPath = (id) => path.join(sessionsDir, `${id}.json`);

async function loadCtx(id) {
  try {
    if (await fs.pathExists(sessionPath(id))) {
      const data = await fs.readJson(sessionPath(id));
      return Array.isArray(data) ? data.slice(-10) : [];
    }
  } catch (_) {}
  return [];
}

async function saveCtx(id, ctx) {
  await fs.writeJson(sessionPath(id), ctx.slice(-10), { spaces: 0 }).catch(() => {});
}

// ─── System Prompt ────────────────────────────────────────────
const SYSTEM = `أنت بوت مساعد ذكي اسمك "Sunken" على فيسبوك ماسنجر.
- أجب باللغة العربية بإيجاز (أقل من 200 كلمة).
- كن ودوداً ومفيداً ومهذباً.
- إذا أُرسلت لك صورة، حللها وصفها.`;

// ─── استدعاء Gemini (مع تجربة كل المفاتيح) ──────────────────
async function callGemini(contents) {
  if (!GEMINI_KEYS.length) throw new Error("NO_KEYS");

  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const key = GEMINI_KEYS[i];
    try {
      const { data } = await axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
        {
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        },
        {
          timeout: 20000,
          headers: { "Content-Type": "application/json", "X-goog-api-key": key },
        }
      );
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) return reply;
    } catch (e) {
      if (e.response?.status === 429 || e.response?.status === 503) {
        // مفتاح تجاوز الحد — جرب التالي فوراً
        continue;
      }
      throw e;
    }
  }
  throw new Error("ALL_KEYS_EXHAUSTED");
}

// ─── استدعاء Groq (fallback) ─────────────────────────────────
async function callGroq(contents) {
  if (!GROQ_KEY) throw new Error("NO_GROQ_KEY");

  const messages = [
    { role: "system", content: SYSTEM },
    ...contents.map(c => ({
      role: c.role === "model" ? "assistant" : "user",
      content: c.parts?.map(p => p.text || "[مرفق]").join(" ") || "[مرفق]",
    })),
  ];

  const { data } = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    { model: "llama-3.3-70b-versatile", messages, temperature: 0.7, max_tokens: 1024 },
    {
      timeout: 15000,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
    }
  );
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) throw new Error("GROQ_EMPTY");
  return reply;
}

// ─── الدالة الرئيسية ─────────────────────────────────────────
async function handle(api, event, prompt, atts = []) {
  const { threadID, messageID, senderID } = event;

  // مسح الذاكرة
  if (prompt.trim().toLowerCase() === "clear" || prompt.trim() === "مسح") {
    try { await fs.unlink(sessionPath(senderID)); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  if (!prompt.trim() && !atts.length) {
    return api.sendMessage(
      "🤖 Sunken AI\n\nأرسل سؤالك أو صورة مع الأمر\nمثال: .gemini ما هذه الصورة؟\n.gemini مسح — لمسح الذاكرة",
      threadID, null, messageID
    );
  }

  // بناء الـ contents
  const ctx = await loadCtx(senderID);
  const parts = [];
  if (prompt.trim()) parts.push({ text: prompt.trim() });

  for (const att of atts) {
    const type = (att.type || "").toLowerCase();
    const url  = att.largePreviewUrl || att.url || att.previewUrl;
    if ((type === "photo" || type === "image") && url) {
      parts.push({ fileData: { mimeType: "image/jpeg", fileUri: url } });
    } else if (url) {
      parts.push({ text: `[مرفق: ${type || "ملف"}]` });
    }
  }

  if (!parts.length) parts.push({ text: "." });

  const contents = [...ctx, { role: "user", parts }];

  // ردّ واجهة المستخدم
  let reply;
  try {
    reply = await callGemini(contents);
  } catch (e) {
    // Fallback إلى Groq
    try {
      reply = await callGroq(contents);
    } catch {
      return api.sendMessage(
        "❌ جميع الخوادم غير متاحة حالياً، حاول لاحقاً.",
        threadID, null, messageID
      );
    }
  }

  api.sendMessage(reply, threadID, null, messageID);

  // حفظ الجلسة
  await saveCtx(senderID, [
    ...ctx,
    { role: "user",  parts: [{ text: prompt || "[مرفق]" }] },
    { role: "model", parts: [{ text: reply }] },
  ]);
}

// ─── تصدير الأمر ─────────────────────────────────────────────
module.exports = {
  config: {
    name: "gemini",
    aliases: ["بوت", "ai", "gm"],
    version: "4.0.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    shortDescription: { ar: "محادثة ذكية مع Gemini / Groq" },
    category: "ذكاء اصطناعي",
    guide: { ar: "{pn}gemini [سؤال]\n{pn}gemini [+ صورة]\n{pn}gemini مسح" },
  },

  onStart: async ({ api, event, args }) => {
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";
    const atts   = [...(event.attachments || []), ...(event.messageReply?.attachments || [])];
    await handle(api, event, prompt, atts);
  },

  onReply: async ({ api, event }) => {
    const prompt = event.body?.trim() || "";
    const atts   = event.attachments || [];
    await handle(api, event, prompt, atts);
  },
};

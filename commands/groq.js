"use strict";
const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");

// ─── الإعدادات ────────────────────────────────────────────────
const GROQ_KEY    = process.env.GROQ_API_KEY;
const MODEL       = "llama-3.3-70b-versatile";
const sessionsDir = path.join(__dirname, "..", "cache", "groq_sessions");
fs.ensureDirSync(sessionsDir);

const SYSTEM = `أنت بوت مساعد ذكي اسمك "Sunken" على فيسبوك ماسنجر.
أجب دائماً باللغة العربية بإيجاز (أقل من 200 كلمة).
كن ودوداً ومهذباً ومفيداً. لا تذكر أنك نموذج ذكاء اصطناعي.`;

// ─── الجلسات ─────────────────────────────────────────────────
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

// ─── استدعاء Groq ─────────────────────────────────────────────
async function callGroq(messages) {
  const { data } = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    { model: MODEL, messages, temperature: 0.7, max_tokens: 1024, top_p: 0.9 },
    {
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`,
      },
    }
  );
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) throw new Error("استجابة فارغة من الخادم");
  return reply;
}

// ─── الدالة الرئيسية ─────────────────────────────────────────
async function handle(api, event, prompt) {
  const { threadID, messageID, senderID } = event;

  if (!GROQ_KEY) {
    return api.sendMessage("❌ مفتاح GROQ_API_KEY غير موجود.", threadID, null, messageID);
  }

  // مسح الذاكرة
  if (prompt.trim().toLowerCase() === "clear" || prompt.trim() === "مسح") {
    try { await fs.unlink(sessionPath(senderID)); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  if (!prompt.trim()) {
    return api.sendMessage(
      "❓ اكتب سؤالك أو رد على رسالة!\nمثال: .ai2 ما هي عاصمة فرنسا؟\n.ai2 مسح — لمسح الذاكرة",
      threadID, null, messageID
    );
  }

  // بناء الرسائل مع السياق
  const ctx = await loadCtx(senderID);
  const messages = [
    { role: "system", content: SYSTEM },
    ...ctx.map(m => ({
      role:    m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
    { role: "user", content: prompt.trim() },
  ];

  let reply;
  try {
    reply = await callGroq(messages);
  } catch (e) {
    let errMsg = "❌ حدث خطأ: ";
    if (e.code === "ECONNABORTED")      errMsg += "⏱️ انتهت مهلة الاتصال";
    else if (e.response?.status === 429) errMsg += "⏳ تم تجاوز الحد، انتظر قليلاً";
    else if (e.response?.status === 401) errMsg += "🔑 مفتاح API غير صالح";
    else errMsg += e.message || "اتصال فاشل";
    return api.sendMessage(errMsg, threadID, null, messageID);
  }

  api.sendMessage(reply, threadID, null, messageID);

  // حفظ الجلسة
  await saveCtx(senderID, [
    ...ctx,
    { role: "user",  content: prompt.trim() },
    { role: "model", content: reply },
  ]);
}

// ─── تصدير الأمر ─────────────────────────────────────────────
module.exports = {
  config: {
    name: "groq",
    aliases: ["llma32", "ai2"],
    version: "4.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "محادثة مع Llama عبر Groq" },
    category: "ذكاء اصطناعي",
    guide: { ar: "{pn}ai2 [سؤالك]\n{pn}ai2 مسح — لمسح الذاكرة" },
  },

  onStart: async ({ api, event, args }) => {
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";
    await handle(api, event, prompt);
  },

  onReply: async ({ api, event }) => {
    const prompt = event.body?.trim() || "";
    await handle(api, event, prompt);
  },
};

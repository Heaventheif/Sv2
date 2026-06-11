"use strict";
const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");

const MODEL       = "meta-llama/llama-3.3-70b-instruct:free";
const sessionsDir = path.join(__dirname, "..", "cache", "groq_sessions");
fs.ensureDirSync(sessionsDir);

const SYSTEM = `أنت بوت مساعد ذكي اسمك "Sunken" على فيسبوك ماسنجر.
أجب دائماً باللغة العربية بإيجاز (أقل من 200 كلمة).
كن ودوداً ومهذباً ومفيداً. لا تذكر أنك نموذج ذكاء اصطناعي.`;

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

async function callAI(messages) {
  const key = process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY;
  if (!key) throw new Error("لا يوجد مفتاح API");

  // OpenRouter (يعمل مع Render بدون حظر)
  const { data } = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    { model: MODEL, messages, temperature: 0.7, max_tokens: 1024 },
    {
      timeout: 20000,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        "HTTP-Referer": "https://render.com",
        "X-Title": "Sunken Bot",
      },
    }
  );
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) throw new Error("استجابة فارغة");
  return reply;
}

async function handle(api, event, prompt) {
  const { threadID, messageID, senderID } = event;

  if (prompt.trim().toLowerCase() === "clear" || prompt.trim() === "مسح") {
    try { await fs.unlink(sessionPath(senderID)); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  if (!prompt.trim()) {
    return api.sendMessage(
      "❓ اكتب سؤالك!\nمثال: .ai2 ما هي عاصمة فرنسا؟\n.ai2 مسح — لمسح الذاكرة",
      threadID, null, messageID
    );
  }

  const ctx = await loadCtx(senderID);
  const messages = [
    { role: "system", content: SYSTEM },
    ...ctx.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
    { role: "user", content: prompt.trim() },
  ];

  let reply;
  try {
    reply = await callAI(messages);
  } catch (e) {
    console.error("[AI2 ERROR]", e.response?.status, e.response?.data || e.message);
    let errMsg = "❌ حدث خطأ: ";
    if (e.response?.status === 403)      errMsg += "🔑 المفتاح محظور (403) — تحقق من OPENROUTER_API_KEY";
    else if (e.response?.status === 401) errMsg += "🔑 مفتاح خاطئ (401)";
    else if (e.response?.status === 429) errMsg += "⏳ تجاوزت الحد (429)";
    else if (e.code === "ECONNABORTED")  errMsg += "⏱️ انتهت مهلة الاتصال";
    else errMsg += e.message || "اتصال فاشل";
    return api.sendMessage(errMsg, threadID, null, messageID);
  }

  api.sendMessage(reply, threadID, null, messageID);

  await saveCtx(senderID, [
    ...ctx,
    { role: "user",  content: prompt.trim() },
    { role: "model", content: reply },
  ]);
}

module.exports = {
  config: {
    name: "groq",
    aliases: ["llma32", "ai2"],
    version: "5.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "محادثة مع Llama عبر OpenRouter" },
    category: "ذكاء اصطناعي",
    guide: { ar: "{pn}ai2 [سؤالك]\n{pn}ai2 مسح" },
  },

  onStart: async ({ api, event, args }) => {
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";
    await handle(api, event, prompt);
  },

  onReply: async ({ api, event }) => {
    await handle(api, event, event.body?.trim() || "");
  },
};

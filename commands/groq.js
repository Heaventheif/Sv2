"use strict";
const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");

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

// ─── المزودون بالترتيب ────────────────────────────────────────
const PROVIDERS = [
  {
    name: "HuggingFace",
    call: async (messages) => {
      const key = process.env.HF_TOKEN;
      if (!key) throw new Error("NO_HF_KEY");
      const { data } = await axios.post(
        "https://api-inference.huggingface.co/models/meta-llama/Llama-3.3-70B-Instruct/v1/chat/completions",
        { model: "meta-llama/Llama-3.3-70B-Instruct", messages, max_tokens: 1024, temperature: 0.7 },
        { timeout: 25000, headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" } }
      );
      return data.choices?.[0]?.message?.content;
    }
  },
  {
    name: "Groq",
    call: async (messages) => {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new Error("NO_GROQ_KEY");
      const { data } = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model: "llama-3.3-70b-versatile", messages, max_tokens: 1024, temperature: 0.7 },
        { timeout: 20000, headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" } }
      );
      return data.choices?.[0]?.message?.content;
    }
  },
  {
    name: "OpenRouter",
    call: async (messages) => {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("NO_OR_KEY");
      const { data } = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        { model: "meta-llama/llama-3.3-70b-instruct:free", messages, max_tokens: 1024, temperature: 0.7 },
        { timeout: 20000, headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://render.com" } }
      );
      return data.choices?.[0]?.message?.content;
    }
  },
];

async function callAI(messages) {
  for (const provider of PROVIDERS) {
    try {
      const reply = await provider.call(messages);
      if (reply) {
        console.log(`[AI2] ✅ ${provider.name}`);
        return reply;
      }
    } catch (e) {
      console.warn(`[AI2] ⚠️ ${provider.name} فشل:`, e.response?.status || e.message?.substring(0, 40));
    }
  }
  throw new Error("كل المزودين فشلوا");
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
    return api.sendMessage("❌ جميع الخوادم غير متاحة حالياً، حاول لاحقاً.", threadID, null, messageID);
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
    version: "6.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "محادثة ذكية — HF + Groq + OpenRouter" },
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

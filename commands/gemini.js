"use strict";
const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(k => k && k.trim().length > 10);

const sessionsDir = path.join(__dirname, "..", "cache", "gemini_sessions");
fs.ensureDirSync(sessionsDir);
const sessionPath = (id) => path.join(sessionsDir, `${id}.json`);

const SYSTEM = `أنت بوت مساعد ذكي اسمك "Sunken" على فيسبوك ماسنجر.
أجب باللغة العربية بإيجاز (أقل من 200 كلمة). كن ودوداً ومفيداً.`;

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

// ─── Gemini ──────────────────────────────────────────────────
async function callGemini(contents) {
  if (!GEMINI_KEYS.length) throw new Error("NO_GEMINI_KEYS");
  for (const key of GEMINI_KEYS) {
    try {
      const { data } = await axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
        { systemInstruction: { parts: [{ text: SYSTEM }] }, contents, generationConfig: { temperature: 0.7, maxOutputTokens: 1024 } },
        { timeout: 20000, headers: { "Content-Type": "application/json", "X-goog-api-key": key } }
      );
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) return reply;
    } catch (e) {
      if (e.response?.status === 429 || e.response?.status === 503) continue;
      throw e;
    }
  }
  throw new Error("ALL_GEMINI_EXHAUSTED");
}

// ─── المزودون البديلون (HF أولاً) ────────────────────────────
const FALLBACKS = [
  {
    name: "HuggingFace",
    call: async (contents) => {
      const key = process.env.HF_TOKEN;
      if (!key) throw new Error("NO_HF_KEY");
      const messages = [
        { role: "system", content: SYSTEM },
        ...contents.map(c => ({ role: c.role === "model" ? "assistant" : "user", content: c.parts?.map(p => p.text || "[مرفق]").join(" ") || "." })),
      ];
      const { data } = await axios.post(
        "https://api-inference.huggingface.co/models/meta-llama/Llama-3.3-70B-Instruct/v1/chat/completions",
        { model: "meta-llama/Llama-3.3-70B-Instruct", messages, max_tokens: 1024, temperature: 0.7 },
        { timeout: 25000, headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" } }
      );
      return data.choices?.[0]?.message?.content;
    }
  },
  {
    name: "OpenRouter",
    call: async (contents) => {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("NO_OR_KEY");
      const messages = [
        { role: "system", content: SYSTEM },
        ...contents.map(c => ({ role: c.role === "model" ? "assistant" : "user", content: c.parts?.map(p => p.text || "[مرفق]").join(" ") || "." })),
      ];
      const { data } = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        { model: "meta-llama/llama-3.3-70b-instruct:free", messages, max_tokens: 1024, temperature: 0.7 },
        { timeout: 20000, headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://render.com" } }
      );
      return data.choices?.[0]?.message?.content;
    }
  },
];

async function handle(api, event, prompt, atts = []) {
  const { threadID, messageID, senderID } = event;

  if (prompt.trim().toLowerCase() === "clear" || prompt.trim() === "مسح") {
    try { await fs.unlink(sessionPath(senderID)); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  if (!prompt.trim() && !atts.length) {
    return api.sendMessage("🤖 Sunken AI\n\nأرسل سؤالك مع الأمر\nمثال: .gemini ما هي عاصمة فرنسا؟\n.gemini مسح — لمسح الذاكرة", threadID, null, messageID);
  }

  const ctx = await loadCtx(senderID);
  const parts = [];
  if (prompt.trim()) parts.push({ text: prompt.trim() });
  for (const att of atts) {
    const type = (att.type || "").toLowerCase();
    parts.push({ text: `[مرفق: ${type || "ملف"}]` });
  }
  if (!parts.length) parts.push({ text: "." });

  const contents = [...ctx, { role: "user", parts }];

  let reply;

  // 1. جرب Gemini أولاً
  try {
    reply = await callGemini(contents);
    console.log("[GEMINI] ✅ نجح");
  } catch (e) {
    console.warn("[GEMINI] ⚠️ فشل:", e.message?.substring(0, 50));
    // 2. جرب البدائل
    for (const fb of FALLBACKS) {
      try {
        reply = await fb.call(contents);
        if (reply) {
          console.log(`[GEMINI] ✅ fallback: ${fb.name}`);
          break;
        }
      } catch (e2) {
        console.warn(`[GEMINI] ⚠️ ${fb.name} فشل:`, e2.response?.status || e2.message?.substring(0, 40));
      }
    }
  }

  if (!reply) return api.sendMessage("❌ جميع الخوادم غير متاحة حالياً، حاول لاحقاً.", threadID, null, messageID);

  api.sendMessage(reply, threadID, null, messageID);

  await saveCtx(senderID, [
    ...ctx,
    { role: "user",  parts: [{ text: prompt || "[مرفق]" }] },
    { role: "model", parts: [{ text: reply }] },
  ]);
}

module.exports = {
  config: {
    name: "gemini",
    aliases: ["بوت", "ai", "gm"],
    version: "6.0.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    shortDescription: { ar: "محادثة ذكية — Gemini + HF + OpenRouter" },
    category: "ذكاء اصطناعي",
    guide: { ar: "{pn}gemini [سؤال]\n{pn}gemini مسح" },
  },
  onStart: async ({ api, event, args }) => {
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";
    const atts   = [...(event.attachments || []), ...(event.messageReply?.attachments || [])];
    await handle(api, event, prompt, atts);
  },
  onReply: async ({ api, event }) => {
    await handle(api, event, event.body?.trim() || "", event.attachments || []);
  },
};

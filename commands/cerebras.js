"use strict";
const axios    = require("axios");
const mongoose = require("mongoose");

const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;

// ─── Schema للجلسات ──────────────────────────────────────────
const sessionSchema = new mongoose.Schema({
  _id:      String,
  messages: { type: Array, default: [] },
  updatedAt: { type: Date, default: Date.now },
});
const Session = mongoose.models.CerebrasSession
  || mongoose.model("CerebrasSession", sessionSchema);

async function loadCtx(id) {
  try {
    if (!global.db) return [];
    const doc = await Session.findById(id).lean();
    return doc?.messages?.slice(-10) || [];
  } catch (_) { return []; }
}

async function saveCtx(id, messages) {
  try {
    if (!global.db) return;
    await Session.findByIdAndUpdate(
      id,
      { messages: messages.slice(-10), updatedAt: new Date() },
      { upsert: true }
    );
  } catch (_) {}
}

const SYSTEM = 'أنت بوت مساعد ذكي اسمك "Sunken". أجب دائماً باللغة العربية بإيجاز (أقل من 300 كلمة). كن ودوداً ومهذباً.';

// النماذج المتاحة
const MODELS = {
  "120b": "gpt-oss-120b",
  "20b":  "gpt-oss-20b",
};
const DEFAULT_MODEL = "gpt-oss-120b";

async function callCerebras(messages, model = DEFAULT_MODEL) {
  if (!CEREBRAS_KEY) throw new Error("CEREBRAS_API_KEY غير مضبوط في ENV");

  const { data } = await axios.post(
    "https://api.cerebras.ai/v1/chat/completions",
    {
      model,
      messages,
      max_completion_tokens: 1024,
      temperature: 0.7,
      top_p: 1,
      stream: false,
    },
    {
      headers: {
        "Authorization": `Bearer ${CEREBRAS_KEY}`,
        "Content-Type":  "application/json",
      },
      timeout: 30000,
    }
  );

  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error("استجابة فارغة من Cerebras");
  return reply;
}

async function handle(api, event, args, registerReply) {
  const { threadID, messageID, senderID } = event;

  // تحديد النموذج إذا كتب المستخدم مثلاً: .gpt 20b سؤال
  let model = DEFAULT_MODEL;
  let promptParts = [...args];

  if (promptParts[0] && MODELS[promptParts[0].toLowerCase()]) {
    model = MODELS[promptParts.shift().toLowerCase()];
  }

  const prompt = promptParts.join(" ").trim();

  // مسح الذاكرة
  if (["clear", "مسح", "reset"].includes(prompt.toLowerCase())) {
    try { await Session.findByIdAndDelete(senderID); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  if (!prompt) {
    return api.sendMessage(
      "❓ اكتب سؤالك!\n" +
      "مثال: .gpt ما هي عاصمة فرنسا؟\n" +
      ".gpt 20b سؤالك — لاستخدام النموذج الأصغر\n" +
      ".gpt مسح — لمسح الذاكرة",
      threadID, null, messageID
    );
  }

  api.sendMessage("⚡ جاري المعالجة بـ Cerebras...", threadID, null, messageID);

  const ctx = await loadCtx(senderID);
  const messages = [
    { role: "system", content: SYSTEM },
    ...ctx,
    { role: "user", content: prompt },
  ];

  let reply;
  try {
    reply = await callCerebras(messages, model);
  } catch (e) {
    console.error("[CEREBRAS]", e.response?.status, e.message?.substring(0, 80));
    const errMsg = e.message.includes("ENV")
      ? "❌ CEREBRAS_API_KEY غير مضبوط في المتغيرات."
      : "❌ الخادم غير متاح حالياً، حاول لاحقاً.";
    return api.sendMessage(errMsg, threadID, null, messageID);
  }

  api.sendMessage(reply, threadID, (err, info) => {
    if (err || !info) return;
    if (registerReply) {
      registerReply(info.messageID, { author: senderID }, async ({ api, event }) => {
        await handle(api, event, [event.body?.trim() || ""], registerReply);
      });
    }
  }, messageID);

  await saveCtx(senderID, [
    ...ctx,
    { role: "user",      content: prompt },
    { role: "assistant", content: reply },
  ]);
}

module.exports = {
  config: {
    name: "gpt",
    aliases: ["cerebras", "gptoss"],
    version: "1.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "محادثة ذكية — Cerebras GPT OSS 120B" },
    category: "ذكاء اصطناعي",
    guide: { ar: "{pn}gpt [سؤالك]\n{pn}gpt 20b [سؤالك]\n{pn}gpt مسح" },
  },

  onStart: async ({ api, event, args, message }) => {
    await handle(api, event, args, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, [event.body?.trim() || ""], message?.registerReply);
  },
};

"use strict";
const axios    = require("axios");
const mongoose = require("mongoose");

const HF_BASE = process.env.HF_SPACE_URL || "https://Solvant-s.hf.space";

// ─── Schema للجلسات ──────────────────────────────────────────
const sessionSchema = new mongoose.Schema({
  _id:     String,
  messages: { type: Array, default: [] },
  updatedAt: { type: Date, default: Date.now },
});
const Session = mongoose.models.GeminiSession || mongoose.model("GeminiSession", sessionSchema);

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

async function callHF(endpoint, messages) {
  const { data } = await axios.post(
    `${HF_BASE}/${endpoint}`,
    { messages },
    { timeout: 30000, headers: { "Content-Type": "application/json" } }
  );
  if (!data.reply) throw new Error("استجابة فارغة");
  return data.reply;
}

async function handle(api, event, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;

  if (prompt.trim().toLowerCase() === "clear" || prompt.trim() === "مسح") {
    try { await Session.findByIdAndDelete(senderID); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  if (!prompt.trim()) {
    return api.sendMessage(
      "🤖 Sunken AI\n\nأرسل سؤالك مع الأمر\nمثال: .gemini ما هي عاصمة فرنسا؟\n.gemini مسح — لمسح الذاكرة",
      threadID, null, messageID
    );
  }

  const ctx = await loadCtx(senderID);
  const messages = [
    ...ctx,
    { role: "user", content: prompt.trim() },
  ];

  let reply;
  try {
    reply = await callHF("gemini", messages);
  } catch (e) {
    console.error("[GEMINI→HF]", e.response?.status, e.message?.substring(0, 60));
    return api.sendMessage("❌ الخادم غير متاح حالياً، حاول لاحقاً.", threadID, null, messageID);
  }

  // إرسال الرد وتسجيل onReply
  api.sendMessage(reply, threadID, (err, info) => {
    if (err || !info) return;
    if (registerReply) {
      registerReply(info.messageID, { author: senderID }, async ({ api, event }) => {
        await handle(api, event, event.body?.trim() || "", registerReply);
      });
    }
  }, messageID);

  // حفظ الجلسة
  await saveCtx(senderID, [
    ...ctx,
    { role: "user",      content: prompt.trim() },
    { role: "assistant", content: reply },
  ]);
}

module.exports = {
  config: {
    name: "gemini",
    aliases: ["بوت", "ai", "gm"],
    version: "8.0.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    shortDescription: { ar: "محادثة ذكية — جلسات MongoDB" },
    category: "ذكاء اصطناعي",
    guide: { ar: "{pn}gemini [سؤال]\n{pn}gemini مسح" },
  },

  onStart: async ({ api, event, args, message }) => {
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";
    await handle(api, event, prompt, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, event.body?.trim() || "", message?.registerReply);
  },
};

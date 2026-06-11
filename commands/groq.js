"use strict";
const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");

const HF_BASE = process.env.HF_SPACE_URL || "https://YOUR-USERNAME-YOUR-SPACE.hf.space";

const sessionsDir = path.join(__dirname, "..", "cache", "groq_sessions");
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

async function callHF(messages) {
  const { data } = await axios.post(
    `${HF_BASE}/groq`,
    { messages },
    { timeout: 30000, headers: { "Content-Type": "application/json" } }
  );
  if (!data.reply) throw new Error("استجابة فارغة");
  return { reply: data.reply, provider: data.provider };
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
    ...ctx.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
    { role: "user", content: prompt.trim() },
  ];

  let reply, provider;
  try {
    ({ reply, provider } = await callHF(messages));
  } catch (e) {
    console.error("[GROQ→HF] فشل:", e.response?.status, e.message?.substring(0, 60));
    return api.sendMessage("❌ الخادم غير متاح حالياً، حاول لاحقاً.", threadID, null, messageID);
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
    version: "7.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "محادثة ذكية عبر HF Space" },
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

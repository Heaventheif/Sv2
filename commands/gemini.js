"use strict";
/**
 * commands/gemini.js  —  Gemini via HF Space
 * ─────────────────────────────────────────────────
 * REFACTORED: حُذف sessionSchema/loadCtx/saveCtx/getUserInfo
 *             (~55 سطراً) → utils/aiSession.js + utils/mediaUtils.js
 */

const axios  = require("axios");
const { loadSession, saveSession, clearSession } = require("../utils/aiSession");
const { getSenderName } = require("../utils/mediaUtils");

const HF_BASE  = (process.env.HF_SPACE_URL || "https://Solvant-s.hf.space").replace(/\/+$/, "");
const NS       = "gemini";
const MAX_MSGS = 20;

async function callHF(messages) {
  const { data } = await axios.post(
    `${HF_BASE}/gemini`,
    { messages },
    { timeout: 30000, headers: { "Content-Type": "application/json" } }
  );
  if (!data.reply) throw new Error("استجابة فارغة");
  return data.reply;
}

async function handle(api, event, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;
  const sessionKey = threadID;

  // ─── مسح الذاكرة ────────────────────────────────────────────
  if (["clear", "مسح"].includes(prompt.trim().toLowerCase())) {
    await clearSession(NS, sessionKey);
    return api.sendMessage("🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }

  if (!prompt.trim()) {
    return api.sendMessage(
      "🤖 Sunken AI\n\nأرسل سؤالك مع الأمر\nمثال: .gemini ما هي عاصمة فرنسا؟\n.gemini مسح — لمسح ذاكرة المجموعة",
      threadID, null, messageID
    );
  }

  // ─── الجلسة + اسم المرسل (بالتوازي) ─────────────────────────
  const [{ messages: ctx }, senderName] = await Promise.all([
    loadSession(NS, sessionKey, MAX_MSGS),
    getSenderName(api, senderID),
  ]);

  const userContent = `[${senderName}]: ${prompt.trim()}`;

  let reply;
  try {
    reply = await callHF([...ctx, { role: "user", content: userContent }]);
  } catch (e) {
    return api.sendMessage("❌ الخادم غير متاح حالياً، حاول لاحقاً.", threadID, null, messageID);
  }

  api.sendMessage(reply, threadID, (err, info) => {
    if (err || !info) return;
    if (registerReply) {
      registerReply(info.messageID, { author: senderID }, async ({ api, event }) => {
        await handle(api, event, event.body?.trim() || "", registerReply);
      });
    }
  }, messageID);

  await saveSession(NS, sessionKey, [
    ...ctx,
    { role: "user",      content: userContent },
    { role: "assistant", content: reply },
  ], null, MAX_MSGS);
}

module.exports = {
  config: {
    name:             "gemini",
    aliases:          ["بوت", "ai", "gm"],
    version:          "9.1.0",
    author:           "Sunken",
    countDown:        5,
    role:             0,
    shortDescription: { ar: "محادثة ذكية جماعية — Gemini + MongoDB" },
    category:         "ذكاء اصطناعي",
    guide:            { ar: "{pn}gemini [سؤال]\n{pn}gemini مسح" },
  },

  onStart: async ({ api, event, args, message }) => {
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";
    await handle(api, event, prompt, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, event.body?.trim() || "", message?.registerReply);
  },
};

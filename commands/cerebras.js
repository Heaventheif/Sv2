"use strict";
/**
 * commands/cerebras.js  —  Cerebras GPT OSS 120B
 * ─────────────────────────────────────────────────
 * BUG FIXED: senderDisplayName كانت تُعيَّن كـ senderID قبل انتهاء getUserInfo
 * REFACTORED: حُذف sessionSchema/loadCtx/saveCtx (60 سطراً) → utils/aiSession.js
 */

const axios      = require("axios");
const { loadSession, saveSession, clearSession } = require("../utils/aiSession");
const { getSenderName } = require("../utils/mediaUtils");

const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;
const NS           = "cerebras"; // namespace في aiSession
const MAX_MSGS     = 20;

const SYSTEM = 'أنت بوت مساعد ذكي اسمك "Sunken". أجب دائماً باللغة العربية بإيجاز (أقل من 300 كلمة). كن ودوداً ومهذباً.';

const MODELS = {
  "120b": "gpt-oss-120b",
  "20b":  "gpt-oss-20b",
};
const DEFAULT_MODEL = "gpt-oss-120b";

async function callCerebras(messages, model) {
  if (!CEREBRAS_KEY) throw new Error("CEREBRAS_API_KEY غير مضبوط في ENV");
  const { data } = await axios.post(
    "https://api.cerebras.ai/v1/chat/completions",
    { model, messages, max_completion_tokens: 1024, temperature: 0.7, top_p: 1, stream: false },
    {
      headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" },
      timeout: 30000,
    }
  );
  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error("استجابة فارغة من Cerebras");
  return reply;
}

async function handle(api, event, args, registerReply) {
  const { threadID, messageID, senderID } = event;
  const sessionKey = threadID; // جلسة جماعية

  let model      = DEFAULT_MODEL;
  let promptArgs = [...args];

  if (promptArgs[0] && MODELS[promptArgs[0].toLowerCase()]) {
    model = MODELS[promptArgs.shift().toLowerCase()];
  }

  const prompt = promptArgs.join(" ").trim();

  // ─── مسح الذاكرة ────────────────────────────────────────────
  if (["clear", "مسح", "reset"].includes(prompt.toLowerCase())) {
    await clearSession(NS, sessionKey);
    return api.sendMessage("🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }

  if (!prompt) {
    return api.sendMessage(
      "❓ اكتب سؤالك!\n" +
      "مثال: .gpt ما هي عاصمة فرنسا؟\n" +
      ".gpt 20b سؤالك — لاستخدام النموذج الأصغر\n" +
      ".gpt مسح — لمسح ذاكرة المجموعة",
      threadID, null, messageID
    );
  }

  // ─── رسالة حالة قابلة للتعديل ────────────────────────────────
  let statusMsgId = null;
  try {
    const sent = await new Promise((res, rej) =>
      api.sendMessage("⚡ جاري المعالجة بـ Cerebras...", threadID, (e, i) => e ? rej(e) : res(i), messageID)
    );
    statusMsgId = sent?.messageID;
  } catch (_) {}

  const updateStatus = async (text) => {
    try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
  };

  // ─── الجلسة + اسم المرسل ─────────────────────────────────────
  const [{ messages: ctx }, senderName] = await Promise.all([
    loadSession(NS, sessionKey, MAX_MSGS),
    getSenderName(api, senderID),
  ]);

  const userContent = `[${senderName}]: ${prompt}`;
  const messages    = [{ role: "system", content: SYSTEM }, ...ctx, { role: "user", content: userContent }];

  let reply;
  try {
    reply = await callCerebras(messages, model);
  } catch (e) {
    const errMsg = e.message.includes("ENV")
      ? "❌ CEREBRAS_API_KEY غير مضبوط في المتغيرات."
      : "❌ الخادم غير متاح حالياً، حاول لاحقاً.";
    return updateStatus(errMsg);
  }

  await updateStatus(reply);

  if (statusMsgId && registerReply) {
    registerReply(statusMsgId, { author: senderID }, async ({ api, event }) => {
      await handle(api, event, [event.body?.trim() || ""], registerReply);
    });
  }

  await saveSession(NS, sessionKey, [
    ...ctx,
    { role: "user",      content: userContent },
    { role: "assistant", content: reply },
  ], null, MAX_MSGS);
}

module.exports = {
  config: {
    name:             "gpt",
    aliases:          ["cerebras", "gptoss"],
    version:          "2.1.0",
    author:           "Sunken",
    countDown:        3,
    role:             0,
    shortDescription: { ar: "محادثة ذكية جماعية — Cerebras GPT OSS 120B" },
    category:         "ذكاء اصطناعي",
    guide:            { ar: "{pn}gpt [سؤالك]\n{pn}gpt 20b [سؤالك]\n{pn}gpt مسح" },
  },

  onStart: async ({ api, event, args, message }) => {
    await handle(api, event, args, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, [event.body?.trim() || ""], message?.registerReply);
  },
};

"use strict";
/**
 * commands/groq.js  —  Llama 4 Scout via HF Space
 * ──────────────────────────────────────────────────
 * REFACTORED: حُذف sessionSchema/loadCtx/saveCtx/downloadImageAsBase64/detectAttachment
 *             (~90 سطراً) → utils/aiSession.js + utils/mediaUtils.js
 */

const axios  = require("axios");
const { loadSession, saveSession, clearSession } = require("../utils/aiSession");
const { detectAttachment, downloadImageAsBase64, getSenderName } = require("../utils/mediaUtils");

const HF_BASE  = (process.env.HF_SPACE_URL || "https://Solvant-s.hf.space").replace(/\/+$/, "");
const NS       = "groq";
const MAX_MSGS = 20;

async function callHF(messages) {
  const { data } = await axios.post(
    `${HF_BASE}/groq`,
    { messages },
    { timeout: 60000, headers: { "Content-Type": "application/json" } }
  );
  if (!data.reply) throw new Error(data.error || "استجابة فارغة");
  return data.reply;
}

async function handle(api, event, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;
  const sessionKey = threadID;

  // ─── مسح الذاكرة ────────────────────────────────────────────
  if (["clear", "مسح", "reset"].includes(prompt.trim().toLowerCase())) {
    await clearSession(NS, sessionKey);
    return api.sendMessage("🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }

  const attachment = detectAttachment(event);

  if (!prompt.trim() && !attachment) {
    return api.sendMessage(
      "❓ اكتب سؤالك أو أرسل صورة/صوت/فيديو!\n" +
      "مثال: .ai2 ما هي عاصمة فرنسا؟\n" +
      ".ai2 مسح — لمسح ذاكرة المجموعة",
      threadID, null, messageID
    );
  }

  // ─── رسالة حالة + اسم مرسل (بالتوازي) ──────────────────────
  const [sentMsg, senderName] = await Promise.all([
    new Promise(res => api.sendMessage(
      attachment
        ? `⏳ جاري تحليل ${attachment.kind === "image" ? "الصورة 🖼️" : attachment.kind === "audio" ? "الصوت 🎵" : "الفيديو 🎬"}...`
        : "⏳ جاري المعالجة...",
      threadID, (e, i) => res(i), messageID
    )),
    getSenderName(api, senderID),
  ]);

  const statusMsgId = sentMsg?.messageID;
  const updateStatus = async (text) => {
    try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
  };

  const { messages: ctx } = await loadSession(NS, sessionKey, MAX_MSGS);

  const displayPrompt = prompt.trim() ||
    (attachment?.kind === "audio" ? "فرّغ هذا الصوت" : attachment?.kind === "video" ? "حلل هذا الفيديو" : "صف هذه الصورة");

  const userContent = `[${senderName}]: ${attachment ? `[${attachment.kind === "image" ? "صورة" : attachment.kind === "audio" ? "صوت" : "فيديو"}] ` : ""}${displayPrompt}`.trim();

  let userMsg;
  if (attachment?.kind === "image") {
    const imgData = await downloadImageAsBase64(attachment.url).catch(() => null);
    userMsg = imgData
      ? { role: "user", content: `[${senderName}]: ${prompt.trim() || "صف هذه الصورة"}`, attachment: { kind: "image", base64: imgData.data, contentType: imgData.mediaType } }
      : { role: "user", content: `[${senderName}]: ${prompt.trim() || "صف هذه الصورة"}` };
    if (!imgData) await updateStatus("⚠️ تعذّر تحميل الصورة، سأجيب على النص فقط...");
  } else if (attachment) {
    userMsg = { role: "user", content: `[${senderName}]: ${displayPrompt}`, attachment: { kind: attachment.kind, url: attachment.url } };
  } else {
    userMsg = { role: "user", content: userContent };
  }

  let reply;
  try {
    reply = await callHF([...ctx, userMsg]);
  } catch (e) {
    return updateStatus("❌ الخادم غير متاح حالياً، حاول لاحقاً.");
  }

  await updateStatus(reply);

  if (statusMsgId && registerReply) {
    registerReply(statusMsgId, { author: senderID }, async ({ api, event }) => {
      await handle(api, event, event.body?.trim() || "", registerReply);
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
    name:             "groq",
    aliases:          ["llma32", "ai2"],
    version:          "10.1.0",
    author:           "Sunken",
    countDown:        3,
    role:             0,
    shortDescription: { ar: "محادثة ذكية جماعية + Vision — Llama 4 Scout" },
    category:         "ذكاء اصطناعي",
    guide:            { ar: "{pn}ai2 [سؤالك]\n{pn}ai2 + صورة/صوت/فيديو\n{pn}ai2 مسح" },
  },

  onStart: async ({ api, event, args, message }) => {
    await handle(api, event, args.join(" ").trim(), message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, event.body?.trim() || "", message?.registerReply);
  },
};

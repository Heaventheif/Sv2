"use strict";
/**
 * commands/gptx.js  —  GPT-4o via GitHub Models
 * ──────────────────────────────────────────────────
 * BUG FIXED: الجلسات كانت في cache/ (نظام ملفات مؤقت يُمسح على Render) →
 *            نُقلت إلى MongoDB عبر utils/aiSession.js
 * REFACTORED: حُذف loadSession/saveSession/clearSession/downloadImageAsBase64 (~50 سطراً)
 */

const OpenAI = require("openai").OpenAI;
const { loadSession, saveSession, clearSession } = require("../utils/aiSession");
const { downloadImageAsBase64, getSenderName }   = require("../utils/mediaUtils");

const token  = process.env.GITHUB_MODELS_TOKEN;
const openai = new OpenAI({ baseURL: "https://models.inference.ai.azure.com", apiKey: token });

const NS       = "gptx";
const MAX_MSGS = 20;

const SYSTEM = `أنت مساعد ذكي اسمك "Sunken". أجب بإيجاز باللغة العربية (أقل من 150 كلمة). كن ودوداً ومهذباً.`;

// ─── Reaction Helper ─────────────────────────────────────────
function setReaction(api, reaction, messageID, threadID) {
  try {
    if (!reaction || !messageID || !threadID) return;
    api.setMessageReaction({ reaction: String(reaction), messageID: String(messageID), threadID: String(threadID) }, () => {});
  } catch (_) {}
}

async function callGPT(context, prompt, imageData = null) {
  const userContent = imageData
    ? [
        { type: "image_url", image_url: { url: `data:${imageData.mediaType};base64,${imageData.data}` } },
        { type: "text", text: prompt || "ما هذه الصورة؟ صفها بالتفصيل." },
      ]
    : prompt;

  const response = await openai.chat.completions.create({
    model:       "gpt-4o",
    temperature: 0.7,
    max_tokens:  2048,
    messages: [
      { role: "system", content: SYSTEM },
      ...context.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: userContent },
    ],
  });

  const reply = response?.choices?.[0]?.message?.content;
  if (!reply) throw new Error("لا توجد استجابة من GPT");
  return reply;
}

async function handleMessage(api, event, message, prompt) {
  const { threadID, messageID, senderID } = event;

  // ─── مسح الذاكرة ────────────────────────────────────────────
  if (["clear", "مسح"].includes(prompt.trim().toLowerCase())) {
    await clearSession(NS, threadID);
    return message.reply("🧹 تم مسح ذاكرة المجموعة.");
  }

  // ─── الجلسة + اسم مرسل (بالتوازي) ──────────────────────────
  const [{ messages: context }, senderName] = await Promise.all([
    loadSession(NS, threadID, MAX_MSGS),
    getSenderName(api, senderID),
  ]);

  // ─── كشف الصور ───────────────────────────────────────────────
  let imageData = null;
  const allAtts = [...(event.messageReply?.attachments || []), ...(event.attachments || [])];
  for (const att of allAtts) {
    if (["photo", "sticker", "animated_image"].includes(att.type)) {
      const imgUrl = att.url || att.largePreviewUrl || att.previewUrl || att.thumbnailUrl;
      if (imgUrl) {
        imageData = await downloadImageAsBase64(imgUrl).catch(() => null);
        if (imageData) break;
      }
    }
  }

  if (!prompt && !imageData) return message.reply("⚠️ اكتب سؤالاً أو ردّ على صورة.");

  setReaction(api, "⏳", messageID, threadID);

  const userText = imageData
    ? `[${senderName}]: [صورة] ${prompt || ""}`.trim()
    : `[${senderName}]: ${prompt}`;

  let reply;
  try {
    reply = await callGPT(context, imageData ? (userText || " ") : userText, imageData);
  } catch (error) {
    let errorMsg = "❌ خطأ:\n";
    if (error.status === 401)      errorMsg += "🔑 المفتاح غير صالح.";
    else if (error.status === 404) errorMsg += "🤖 النموذج غير متاح.";
    else if (error.status === 429) errorMsg += "⏱️ تم تجاوز الحد اليومي.";
    else errorMsg += (error.message || "خطأ غير معروف").substring(0, 100);
    setReaction(api, "❌", messageID, threadID);
    return message.reply(errorMsg);
  }

  if (!reply) {
    setReaction(api, "❌", messageID, threadID);
    return message.reply("❌ استجابة فارغة.");
  }

  setReaction(api, "🟢", messageID, threadID);
  const info = await message.reply(reply);
  if (info?.messageID) message.registerReply(info.messageID, { threadID }, module.exports.onReply);

  await saveSession(NS, threadID, [
    ...context,
    { role: "user",      content: userText },
    { role: "assistant", content: reply },
  ], null, MAX_MSGS);
}

module.exports = {
  config: {
    name:             "gptx",
    version:          "2.1.0",
    author:           "Sunken",
    countDown:        3,
    role:             0,
    usePrefix:        false,
    shortDescription: { ar: "GPT-4o | ذاكرة جماعية | ردود تلقائية | يفهم الصور" },
    category:         "ذكاء اصطناعي",
    guide:            { ar: "gptx [سؤالك]\ngptx مسح — مسح ذاكرة المجموعة" },
  },

  onStart: async ({ api, event, args, message }) => {
    let prompt = args.join(" ").trim();
    if (!prompt && event.messageReply) prompt = event.messageReply.body || "";
    await handleMessage(api, event, message, prompt);
  },

  onReply: async ({ api, event, message }) => {
    const prompt = event.body?.trim() || "";
    if (!prompt && !event.attachments?.length) return;
    await handleMessage(api, event, message, prompt);
  },
};

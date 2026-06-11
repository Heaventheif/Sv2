"use strict";
const axios    = require("axios");
const mongoose = require("mongoose");

const HF_BASE = process.env.HF_SPACE_URL || "https://Solvant-s.hf.space";

// ─── Schema للجلسات ──────────────────────────────────────────
const sessionSchema = new mongoose.Schema({
  _id:      String,
  messages: { type: Array, default: [] },
  updatedAt: { type: Date, default: Date.now },
});
const Session = mongoose.models.GroqSession
  || mongoose.model("GroqSession", sessionSchema);

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

// ─── كشف المرفق من event ─────────────────────────────────────
function detectAttachment(event) {
  const att = event.attachments?.[0];
  if (!att) return null;

  const type = att.type?.toLowerCase() || "";

  if (["photo", "sticker", "animated_image"].includes(type)) {
    return {
      kind: "image",
      url:  att.largePreviewUrl || att.previewUrl || att.url || att.thumbnailUrl,
    };
  }
  if (type === "audio") {
    return { kind: "audio", url: att.url };
  }
  if (type === "video") {
    return { kind: "video", url: att.url || att.previewUrl };
  }
  if (type === "file") {
    const ext = (att.filename || "").split(".").pop().toLowerCase();
    if (["jpg","jpeg","png","gif","webp"].includes(ext))
      return { kind: "image", url: att.url };
    if (["mp3","m4a","ogg","wav","flac"].includes(ext))
      return { kind: "audio", url: att.url };
    if (["mp4","mov","avi","mkv"].includes(ext))
      return { kind: "video", url: att.url };
  }
  return null;
}

// ─── بناء رسالة المستخدم (نص + مرفق اختياري) ────────────────
function buildUserMessage(prompt, attachment) {
  // بدون مرفق — نص عادي
  if (!attachment) {
    return { role: "user", content: prompt || "وصف ما تراه" };
  }

  // مع مرفق — نرسل URL للـ HF ليحمّله
  return {
    role: "user",
    content: prompt || "وصف ما تراه",
    attachment: {
      kind: attachment.kind,  // image | audio | video
      url:  attachment.url,
    },
  };
}

// ─── استدعاء HF ──────────────────────────────────────────────
async function callHF(messages) {
  const { data } = await axios.post(
    `${HF_BASE}/groq`,
    { messages },
    { timeout: 60000, headers: { "Content-Type": "application/json" } }
  );
  if (!data.reply) throw new Error(data.error || "استجابة فارغة");
  return data.reply;
}

// ─── المعالج الرئيسي ─────────────────────────────────────────
async function handle(api, event, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;

  // مسح الذاكرة
  if (["clear","مسح","reset"].includes(prompt.trim().toLowerCase())) {
    try { await Session.findByIdAndDelete(senderID); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  const attachment = detectAttachment(event);

  // لا نص ولا مرفق
  if (!prompt.trim() && !attachment) {
    return api.sendMessage(
      "❓ اكتب سؤالك أو أرسل صورة/صوت/فيديو!\n" +
      "مثال: .ai2 ما هي عاصمة فرنسا؟\n" +
      ".ai2 مسح — لمسح الذاكرة",
      threadID, null, messageID
    );
  }

  // مؤشر انتظار
  const waitMsg = attachment
    ? `⏳ جاري تحليل ${attachment.kind === "image" ? "الصورة 🖼️" : attachment.kind === "audio" ? "الصوت 🎵" : "الفيديو 🎬"}...`
    : "⏳ جاري المعالجة...";
  api.sendMessage(waitMsg, threadID, null, messageID);

  const ctx = await loadCtx(senderID);
  const userMsg = buildUserMessage(prompt.trim(), attachment);
  const messages = [...ctx, userMsg];

  let reply;
  try {
    reply = await callHF(messages);
  } catch (e) {
    console.error("[GROQ→HF]", e.response?.status, e.message?.substring(0, 80));
    return api.sendMessage(
      "❌ الخادم غير متاح حالياً، حاول لاحقاً.",
      threadID, null, messageID
    );
  }

  api.sendMessage(reply, threadID, (err, info) => {
    if (err || !info) return;
    if (registerReply) {
      registerReply(info.messageID, { author: senderID }, async ({ api, event }) => {
        await handle(api, event, event.body?.trim() || "", registerReply);
      });
    }
  }, messageID);

  // حفظ السياق — نحفظ نص فقط (بدون attachment لتوفير المساحة)
  const userMsgForCtx = { role: "user", content: userMsg.content };
  await saveCtx(senderID, [
    ...ctx,
    userMsgForCtx,
    { role: "assistant", content: reply },
  ]);
}

module.exports = {
  config: {
    name: "groq",
    aliases: ["llma32", "ai2"],
    version: "9.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "محادثة ذكية + Vision — Llama 4 Scout" },
    category: "ذكاء اصطناعي",
    guide: { ar: "{pn}ai2 [سؤالك]\n{pn}ai2 [صورة/صوت/فيديو] [وصف اختياري]\n{pn}ai2 مسح" },
  },

  onStart: async ({ api, event, args, message }) => {
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";
    await handle(api, event, prompt, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, event.body?.trim() || "", message?.registerReply);
  },
};

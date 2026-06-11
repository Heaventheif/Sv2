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

// ─── كشف المرفق من event (FCA) ───────────────────────────────
// FCA يضع الصور في عدة أماكن حسب طريقة الإرسال
function detectAttachment(event) {
  // جمع كل مصادر المرفقات المحتملة
  const sources = [
    ...(event.attachments         || []),
    ...(event.messageReply?.attachments || []),
  ];

  for (const att of sources) {
    if (!att) continue;
    const type = (att.type || att.attachmentType || "").toLowerCase();

    // ─── صورة ───────────────────────────────────────────────
    if (
      type === "photo"   ||
      type === "image"   ||
      type === "sticker" ||
      type === "animated_image" ||
      type === "share"   // بعض الصور تأتي كـ share
    ) {
      const url =
        att.largePreviewUrl ||
        att.previewUrl      ||
        att.largePreviewUri ||   // FCA v4
        att.previewUri      ||
        att.uri             ||
        att.url             ||
        att.thumbnailUrl    ||
        att.image?.uri;
      if (url) return { kind: "image", url };
    }

    // ─── صوت ────────────────────────────────────────────────
    if (type === "audio" || type === "voice_message") {
      const url = att.url || att.audioUrl || att.uri;
      if (url) return { kind: "audio", url };
    }

    // ─── فيديو ──────────────────────────────────────────────
    if (type === "video" || type === "video_inline") {
      const url = att.url || att.uri || att.previewUrl;
      if (url) return { kind: "video", url };
    }

    // ─── ملف عام — نخمن من الامتداد ─────────────────────────
    if (type === "file" || type === "document") {
      const ext = (att.filename || att.name || "").split(".").pop().toLowerCase();
      const url = att.url || att.uri;
      if (!url) continue;
      if (["jpg","jpeg","png","gif","webp","bmp"].includes(ext))
        return { kind: "image", url };
      if (["mp3","m4a","ogg","wav","flac","aac"].includes(ext))
        return { kind: "audio", url };
      if (["mp4","mov","avi","mkv","webm"].includes(ext))
        return { kind: "video", url };
    }
  }

  // ─── لا شيء وُجد — سجّل للـ debug ──────────────────────────
  if (sources.length > 0) {
    console.warn("[GROQ] attachment غير معروف:", JSON.stringify(sources[0]).substring(0, 200));
  }

  return null;
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
  const userMsg = {
    role:    "user",
    content: prompt.trim() || (attachment?.kind === "image" ? "وصف هذه الصورة" : attachment?.kind === "audio" ? "فرّغ هذا الصوت" : "حلل هذا الفيديو"),
    ...(attachment ? { attachment } : {}),
  };
  const messages = [...ctx, userMsg];

  let reply;
  try {
    reply = await callHF(messages);
  } catch (e) {
    console.error("[GROQ→HF]", e.response?.status, e.message?.substring(0, 80));
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

  await saveCtx(senderID, [
    ...ctx,
    { role: "user",      content: userMsg.content },
    { role: "assistant", content: reply },
  ]);
}

module.exports = {
  config: {
    name: "groq",
    aliases: ["llma32", "ai2"],
    version: "9.1.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "محادثة ذكية + Vision — Llama 4 Scout" },
    category: "ذكاء اصطناعي",
    guide: { ar: "{pn}ai2 [سؤالك]\n{pn}ai2 + صورة/صوت/فيديو\n{pn}ai2 مسح" },
  },

  onStart: async ({ api, event, args, message }) => {
    const prompt = args.join(" ").trim() || "";
    await handle(api, event, prompt, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, event.body?.trim() || "", message?.registerReply);
  },
};

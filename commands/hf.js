"use strict";
/**
 * commands/hf.js  —  HuggingFace Multi-Model AI
 * ──────────────────────────────────────────────────
 * REFACTORED: حُذف sessionSchema/loadCtx/saveCtx/downloadAsBase64/detectAttachment
 *             (~110 سطراً) → utils/aiSession.js + utils/mediaUtils.js
 */

const axios  = require("axios");
const { loadSession, saveSession, clearSession } = require("../utils/aiSession");
const { detectAttachment, downloadImageAsBase64, getSenderName } = require("../utils/mediaUtils");

const HF_BASE  = (process.env.HF_SPACE_URL || "").replace(/\/+$/, "");
const NS       = "hf";
const MAX_MSGS = 10;

// ─── تنظيف وسوم التفكير من الرد ─────────────────────────────
function cleanReply(text) {
  text = text.replace(/<(?:think|thinking|analysis|reflection)>[\s\S]*?<\/(?:think|thinking|analysis|reflection)>/gi, "");
  const match = text.match(/(?:الجواب|الإجابة|Answer)\s*:\s*/i);
  if (match) text = text.slice(text.indexOf(match[0]) + match[0].length);
  return text.trim();
}

async function callHF(messages, model) {
  if (!HF_BASE) throw new Error("HF_SPACE_URL غير مضبوط في متغيرات البيئة");
  const { data } = await axios.post(
    `${HF_BASE}/hf`,
    { messages, model, max_tokens: 512 },
    { timeout: 65000, headers: { "Content-Type": "application/json" } }
  );
  if (data.error) throw new Error(data.error);
  if (!data.reply) throw new Error("استجابة فارغة من الخادم");
  return { reply: cleanReply(data.reply), model_used: data.model_used || model };
}

async function handle(api, event, args, registerReply) {
  const { threadID, messageID, senderID } = event;
  const firstArg = args[0]?.toLowerCase() || "";

  // ─── مسح الذاكرة ────────────────────────────────────────────
  if (["مسح", "clear", "reset"].includes(firstArg)) {
    await clearSession(NS, threadID);
    return api.sendMessage("🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }

  // ─── عرض النماذج ─────────────────────────────────────────────
  if (["نماذج", "models", "list"].includes(firstArg)) {
    return api.sendMessage(
      `🤖 النماذج المتاحة في HF AI:\n\n` +
      `━━━━━ Llama (Meta) ━━━━━\n• llama4 ← الافتراضي ✅ يدعم الصور\n• llama / llama8 → Llama-3.1-8B\n• llama70 → Llama-3.3-70B\n\n` +
      `━━━━━ Qwen (Alibaba) ━━━━━\n• qwen7 → Qwen2.5-7B\n• qwen / qwen72 → Qwen2.5-72B\n• qwen3 → Qwen3-235B\n\n` +
      `━━━━━ Mistral ━━━━━\n• mistral → Mistral-7B\n• mistral22 → Mistral-Small-22B ✅ يدعم الصور\n• mixtral → Mixtral-8x7B\n\n` +
      `━━━━━ Google ━━━━━\n• gemma → Gemma-3-27B ✅ يدعم الصور\n• gemma4 → Gemma-3-4B ✅ يدعم الصور\n\n` +
      `━━━━━ DeepSeek ━━━━━\n• deepseek7 → DeepSeek-R1-7B\n• deepseek → DeepSeek-R1-32B\n\n` +
      `━━━━━ أخرى ━━━━━\n• phi / phi4 → Microsoft Phi\n• zephyr → Zephyr-7B\n• command → Cohere Command-R\n\n` +
      `📸 النماذج التي تدعم الصور: llama4، mistral22، gemma، gemma4\n` +
      `🧹 .hf مسح — مسح الذاكرة`,
      threadID, null, messageID
    );
  }

  // ─── تحديد النموذج والسؤال ───────────────────────────────────
  const { messages: savedCtx, model: savedModel } = await loadSession(NS, threadID, MAX_MSGS);

  const looksLikeModel = firstArg && !firstArg.includes(" ") &&
    !/^[\u0600-\u06FF]/.test(firstArg) &&
    (firstArg.includes("/") || firstArg.length <= 15);

  let model, promptArgs;
  if (looksLikeModel && args.length >= 1) {
    model      = args[0];
    promptArgs = args.slice(1);
  } else {
    model      = savedModel || "llama4";
    promptArgs = args;
  }

  let prompt = promptArgs.join(" ").trim();
  if (!prompt && event.messageReply?.body) prompt = event.messageReply.body.trim();

  const attachment = detectAttachment(event);

  if (!prompt && !attachment) {
    return api.sendMessage(
      `🤖 HF AI — النموذج الحالي: ${model}\n\n` +
      `.hf [سؤالك]  ← ${model} افتراضي\n` +
      `.hf qwen7 اشرح البرمجة\n` +
      `.hf gemma + صورة — تحليل الصورة\n` +
      `.hf نماذج — كل النماذج\n` +
      `.hf مسح — مسح الذاكرة`,
      threadID, null, messageID
    );
  }

  if (!HF_BASE)
    return api.sendMessage("❌ HF_SPACE_URL غير مضبوط في متغيرات البيئة", threadID, null, messageID);

  // ─── رسالة حالة + اسم مرسل (بالتوازي) ──────────────────────
  const [sentMsg, senderName] = await Promise.all([
    new Promise(res => api.sendMessage(
      attachment
        ? `⏳ جاري تحليل ${attachment.kind === "image" ? "الصورة 🖼️" : attachment.kind === "audio" ? "الصوت 🎵" : "الفيديو 🎬"} لـ ${model}...`
        : `⏳ جاري السؤال لـ ${model}...`,
      threadID, (e, i) => res(i), messageID
    )),
    getSenderName(api, senderID),
  ]);

  const statusMsgId = sentMsg?.messageID;
  const updateStatus = async (text) => {
    try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
  };

  let userMsg;
  if (attachment?.kind === "image") {
    const imgData = await downloadImageAsBase64(attachment.url).catch(() => null);
    userMsg = imgData
      ? { role: "user", content: `[${senderName}]: ${prompt || "صف هذه الصورة"}`, attachment: { kind: "image", base64: imgData.data, contentType: imgData.mediaType } }
      : { role: "user", content: `[${senderName}]: ${prompt || "صف هذه الصورة"}` };
    if (!imgData) await updateStatus("⚠️ تعذّر تحميل الصورة، سأجيب على النص فقط...");
  } else if (attachment) {
    userMsg = { role: "user", content: `[${senderName}]: ${prompt || (attachment.kind === "audio" ? "فرّغ هذا الصوت" : "حلل هذا الفيديو")}`, attachment: { kind: attachment.kind, url: attachment.url } };
  } else {
    userMsg = { role: "user", content: `[${senderName}]: ${prompt}` };
  }

  try {
    const { reply, model_used } = await callHF([...savedCtx, userMsg], model);

    await updateStatus(reply);

    if (statusMsgId && registerReply) {
      registerReply(statusMsgId, { author: senderID }, async ({ api, event }) => {
        await handle(api, event, [model, event.body?.trim() || ""].filter(Boolean), registerReply);
      });
    }

    await saveSession(NS, threadID, [
      ...savedCtx,
      { role: "user",      content: userMsg.content },
      { role: "assistant", content: reply },
    ], model_used, MAX_MSGS);

  } catch (err) {
    let msg = "❌ خطأ: ";
    if (err.code === "ECONNABORTED" || err.message?.includes("timeout"))
      msg += "⏱️ انتهت مهلة الاتصال — جرب نموذجاً أصغر مثل: llama أو gemma4";
    else
      msg += (err.message || "فشل الاتصال").substring(0, 120);
    await updateStatus(msg);
  }
}

module.exports = {
  config: {
    name:             "hf",
    aliases:          ["huggingface", "hfai"],
    version:          "3.2.0",
    author:           "Sunken",
    countDown:        5,
    role:             0,
    shortDescription: { ar: "ذكاء اصطناعي — llama4 افتراضي + دعم الصور" },
    longDescription:  { ar: "تحدث مع أي نموذج من HuggingFace\nالنموذج الافتراضي: llama4 (يدعم الصور ✅)" },
    category:         "ذكاء اصطناعي",
    guide:            { ar: "{pn}hf [سؤالك]\n{pn}hf qwen7 اشرح البرمجة\n{pn}hf نماذج\n{pn}hf مسح" },
  },

  onStart: async ({ api, event, args, message }) => {
    await handle(api, event, args, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, [event.body?.trim() || ""], message?.registerReply);
  },
};

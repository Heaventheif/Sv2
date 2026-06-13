"use strict";
const axios    = require("axios");
const mongoose = require("mongoose");

const HF_BASE = process.env.HF_SPACE_URL || "";

// ─── Schema للجلسات ──────────────────────────────────────────
const sessionSchema = new mongoose.Schema({
  _id:      String,
  messages: { type: Array, default: [] },
  model:    { type: String, default: "qwen" },
  updatedAt:{ type: Date,   default: Date.now },
});
const Session = mongoose.models.HFSession
  || mongoose.model("HFSession", sessionSchema);

async function loadCtx(id) {
  try {
    if (!global.db) return { messages: [], model: "qwen" };
    const doc = await Session.findById(id).lean();
    return {
      messages: doc?.messages?.slice(-10) || [],
      model:    doc?.model || "qwen",
    };
  } catch (_) { return { messages: [], model: "qwen" }; }
}

async function saveCtx(id, messages, model) {
  try {
    if (!global.db) return;
    await Session.findByIdAndUpdate(
      id,
      { messages: messages.slice(-10), model, updatedAt: new Date() },
      { upsert: true }
    );
  } catch (_) {}
}

// ─── النماذج المتاحة كـ shortcuts (للعرض فقط) ───────────────
const MODEL_LIST = [
  "qwen / qwen72 / qwen7 / qwen3",
  "llama / llama70 / llama8 / llama4",
  "mistral / mistral22 / mixtral",
  "deepseek / deepseek7",
  "phi / phi4",
  "gemma / gemma9",
  "command | falcon | yi | zephyr",
  "أو أي معرّف كامل: Qwen/Qwen2.5-72B-Instruct",
];

// ─── استدعاء HF Space ────────────────────────────────────────
async function callHF(messages, model) {
  if (!HF_BASE) throw new Error("HF_SPACE_URL غير مضبوط في متغيرات Render");

  const { data } = await axios.post(
    `${HF_BASE.replace(/\/+$/, "")}/hf`,
    { messages, model, max_tokens: 512 },
    { timeout: 65000, headers: { "Content-Type": "application/json" } }
  );

  if (data.error) throw new Error(data.error);
  if (!data.reply) throw new Error("استجابة فارغة من الخادم");
  return { reply: data.reply, model_used: data.model_used || model };
}

// ─── المعالج الرئيسي ─────────────────────────────────────────
async function handle(api, event, args, registerReply) {
  const { threadID, messageID, senderID } = event;

  const firstArg = args[0]?.toLowerCase() || "";

  // ─── مسح الذاكرة ─────────────────────────────────────────
  if (["مسح", "clear", "reset"].includes(firstArg)) {
    try { await Session.findByIdAndDelete(senderID); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المحادثة.", threadID, null, messageID);
  }

  // ─── عرض النماذج ─────────────────────────────────────────
  if (["نماذج", "models", "list"].includes(firstArg)) {
    return api.sendMessage(
      `🤖 النماذج المتاحة:\n\n${MODEL_LIST.join("\n")}\n\n` +
      `مثال: .hf qwen ما هو الذكاء الاصطناعي؟\n` +
      `      .hf llama4 اشرح لي البرمجة\n` +
      `      .hf Qwen/Qwen2.5-72B-Instruct سؤالك`,
      threadID, null, messageID
    );
  }

  // ─── تحديد النموذج والسؤال ───────────────────────────────
  // الصيغة: .hf [نموذج] [سؤال]
  // إذا كان arg الأول يشبه اسم نموذج (بدون مسافة أو يحتوي "/") → نموذج
  // وإلا → نموذج افتراضي من الجلسة السابقة
  const { messages: savedCtx, model: savedModel } = await loadCtx(senderID);

  let model, promptArgs;

  // كشف إذا كان arg الأول هو نموذج:
  // - لا يحتوي على مسافة (كلمة واحدة)
  // - لا يبدأ بعلامات استفهام أو أرقام
  // - يشبه shortcut أو معرّف HF (يحتوي /)
  const looksLikeModel = firstArg &&
    !firstArg.includes(" ") &&
    !/^[\u0600-\u06FF]/.test(firstArg) && // ليس عربي
    (firstArg.includes("/") || firstArg.length <= 15);

  if (looksLikeModel && args.length > 1) {
    model      = args[0];
    promptArgs = args.slice(1);
  } else if (looksLikeModel && args.length === 1) {
    // نموذج فقط بدون سؤال → اعرض مساعدة
    model      = args[0];
    promptArgs = [];
  } else {
    model      = savedModel;
    promptArgs = args;
  }

  let prompt = promptArgs.join(" ").trim();

  // من الرد على رسالة
  if (!prompt && event.messageReply?.body)
    prompt = event.messageReply.body.trim();

  // بدون سؤال
  if (!prompt) {
    return api.sendMessage(
      `🤖 HF AI — النموذج الحالي: ${model}\n\n` +
      `📝 الاستخدام:\n` +
      `.hf [نموذج] [سؤالك]\n\n` +
      `💡 أمثلة:\n` +
      `.hf qwen ما هو الذكاء الاصطناعي؟\n` +
      `.hf llama4 اشرح لي البرمجة\n` +
      `.hf mistral كيف تعمل الشبكات العصبية؟\n\n` +
      `📋 .hf نماذج — لعرض كل النماذج المتاحة\n` +
      `🧹 .hf مسح — لمسح الذاكرة`,
      threadID, null, messageID
    );
  }

  if (!HF_BASE) {
    return api.sendMessage("❌ HF_SPACE_URL غير مضبوط في متغيرات Render", threadID, null, messageID);
  }

  // مؤشر انتظار
  api.sendMessage(`⏳ جاري السؤال لـ ${model}...`, threadID, null, messageID);

  const messages = [
    ...savedCtx,
    { role: "user", content: prompt },
  ];

  try {
    const { reply, model_used } = await callHF(messages, model);

    api.sendMessage(reply, threadID, (err, info) => {
      if (err || !info) return;
      if (registerReply) {
        registerReply(info.messageID, { author: senderID }, async ({ api, event }) => {
          await handle(api, event, [model, event.body?.trim() || ""].filter(Boolean), registerReply);
        });
      }
    }, messageID);

    await saveCtx(senderID, [
      ...savedCtx,
      { role: "user",      content: prompt },
      { role: "assistant", content: reply  },
    ], model_used);

  } catch (err) {
    let msg = "❌ خطأ: ";
    if (err.code === "ECONNABORTED" || err.message?.includes("timeout"))
      msg += "⏱️ انتهت مهلة الاتصال — النموذج قد يكون كبيراً، جرب نموذجاً أصغر";
    else if (err.message?.includes("غير موجود"))
      msg += err.message;
    else if (err.message?.includes("Gated") || err.message?.includes("صلاحية"))
      msg += err.message;
    else if (err.message?.includes("التحميل"))
      msg += err.message + " ثم أعد المحاولة";
    else if (err.message?.includes("HF_SPACE_URL"))
      msg += err.message;
    else
      msg += (err.message || "فشل الاتصال").substring(0, 120);

    api.sendMessage(msg, threadID, null, messageID);
  }
}

module.exports = {
  config: {
    name:             "hf",
    aliases:          ["huggingface", "hfai"],
    version:          "2.0.0",
    author:           "Sunken",
    countDown:        5,
    role:             0,
    shortDescription: { ar: "ذكاء اصطناعي — أي نموذج من HuggingFace" },
    category:         "ذكاء اصطناعي",
    guide: {
      ar:
        "{pn}hf [نموذج] [سؤالك]\n" +
        "{pn}hf qwen ما هو الذكاء الاصطناعي؟\n" +
        "{pn}hf llama4 اشرح لي البرمجة\n" +
        "{pn}hf نماذج — عرض كل النماذج\n" +
        "{pn}hf مسح — مسح الذاكرة",
    },
  },

  onStart: async ({ api, event, args, message }) => {
    await handle(api, event, args, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    // نستخرج النموذج المحفوظ من الجلسة تلقائياً
    await handle(api, event, [event.body?.trim() || ""], message?.registerReply);
  },
};

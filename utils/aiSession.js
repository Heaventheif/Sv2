"use strict";
/**
 * utils/aiSession.js
 * ─────────────────────────────────────────────────────────────
 * إدارة جلسات المحادثة المشتركة لجميع أوامر الذكاء الاصطناعي
 * تستخدم MongoDB إذا كانت متاحة، أو ذاكرة مؤقتة (Map) كبديل
 */

const mongoose = require("mongoose");

// ─── نموذج الجلسة (Schema) مُشترك لجميع الأوامر ─────────────
const sessionSchema = new mongoose.Schema(
  {
    _id:       String,
    namespace: { type: String, required: true, index: true },
    messages:  { type: Array, default: [] },
    model:     { type: String, default: null },
  },
  { timestamps: true }
);

const SessionModel =
  mongoose.models.AISession ||
  mongoose.model("AISession", sessionSchema);

// ─── ذاكرة مؤقتة للعمل بدون MongoDB ─────────────────────────
const _memCache = new Map(); // key: `${namespace}:${id}`

// ─── تحميل الجلسة ─────────────────────────────────────────────
async function loadSession(namespace, id, maxMsgs = 20) {
  const key = `${namespace}:${id}`;
  try {
    if (global.db) {
      const doc = await SessionModel.findById(key).lean();
      return {
        messages: (doc?.messages || []).slice(-maxMsgs),
        model:    doc?.model || null,
      };
    }
  } catch (_) {}

  // Fallback → ذاكرة مؤقتة
  const cached = _memCache.get(key) || { messages: [], model: null };
  return {
    messages: cached.messages.slice(-maxMsgs),
    model:    cached.model,
  };
}

// ─── حفظ الجلسة ───────────────────────────────────────────────
async function saveSession(namespace, id, messages, model = null, maxMsgs = 20) {
  const key     = `${namespace}:${id}`;
  const sliced  = messages.slice(-maxMsgs);

  // Fallback أولاً (دائماً يُحفظ في الذاكرة)
  _memCache.set(key, { messages: sliced, model });

  try {
    if (global.db) {
      await SessionModel.findByIdAndUpdate(
        key,
        { namespace, messages: sliced, model },
        { upsert: true }
      );
    }
  } catch (_) {}
}

// ─── حذف الجلسة ───────────────────────────────────────────────
async function clearSession(namespace, id) {
  const key = `${namespace}:${id}`;
  _memCache.delete(key);
  try {
    if (global.db) await SessionModel.findByIdAndDelete(key);
  } catch (_) {}
}

// ─── تنظيف الذاكرة المؤقتة دورياً (كل 30 دقيقة) ─────────────
setInterval(() => {
  const limit = 500;
  if (_memCache.size > limit) {
    const keys = [..._memCache.keys()].slice(0, _memCache.size - limit);
    keys.forEach(k => _memCache.delete(k));
  }
}, 30 * 60 * 1000).unref();

module.exports = { loadSession, saveSession, clearSession };

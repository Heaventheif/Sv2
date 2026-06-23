"use strict";
/**
 * commands/supportfunc/EnkiduReplyFunc.js
 * ─────────────────────────────────────────────────────────────
 * أداة مساعدة اختيارية لبناء ردود محادثة تفاعلية متقدمة.
 *
 * ملاحظة: index.js يستخدم global.Kagenou.replies لنظام الردود الرئيسي.
 * هذه الأداة تُستخدم بشكل مستقل من أوامر تحتاج منطق reply أكثر تعقيداً.
 *
 * الاستخدام:
 *   const { createReply } = require("./supportfunc/EnkiduReplyFunc");
 *   await createReply(api, { threadID, message: "نص", callback: fn });
 */

const REPLY_TIMEOUT_MS = 30 * 60 * 1000;

// ─── إنشاء رد تفاعلي ─────────────────────────────────────────
function createReply(api, opts) {
  const {
    threadID,
    messageID,
    message,
    attachment,
    callback,
    data      = {},
    keepAlive = true,
    authorID  = null,
    onExpire  = null,
  } = opts;

  if (!threadID) throw new Error("threadID مطلوب");
  if (typeof callback !== "function") throw new Error("callback يجب أن يكون دالة");

  return new Promise((resolve, reject) => {
    api.sendMessage(
      { body: message || "", attachment },
      threadID,
      (err, info) => {
        if (err) return reject(err);
        const msgID = info?.messageID;
        if (!msgID) return reject(new Error("لم يُعَد messageID من sendMessage"));

        const entry = {
          callback,
          author:    authorID,
          data,
          keep:      keepAlive,
          expiresAt: Date.now() + REPLY_TIMEOUT_MS,
        };

        // ← نستخدم global.Kagenou.replies للتوافق مع index.js
        global.Kagenou.replies[msgID] = {
          ...entry,
          timestamp: Date.now(),
        };

        const timer = setTimeout(() => {
          delete global.Kagenou.replies[msgID];
          if (typeof onExpire === "function") {
            try { onExpire({ api, threadID, originalMessageID: msgID }); } catch (_) {}
          }
        }, REPLY_TIMEOUT_MS);
        if (timer.unref) timer.unref();

        resolve({ messageID: msgID, entry });
      },
      messageID || null
    );
  });
}

// ─── حذف رد ──────────────────────────────────────────────────
function remove(messageID) {
  delete global.Kagenou.replies[messageID];
}

// ─── التحقق من وجود رد ───────────────────────────────────────
function has(messageID) {
  const entry = global.Kagenou.replies[messageID];
  if (!entry) return false;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    delete global.Kagenou.replies[messageID];
    return false;
  }
  return true;
}

module.exports = { createReply, remove, has, REPLY_TIMEOUT_MS };

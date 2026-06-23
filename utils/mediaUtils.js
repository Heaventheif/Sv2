"use strict";
/**
 * utils/mediaUtils.js
 * ─────────────────────────────────────────────────────────────
 * أدوات الوسائط المشتركة لجميع أوامر الذكاء الاصطناعي
 * تحذف التكرار الموجود في: groq.js / gptx.js / hf.js
 */

const axios = require("axios");
const path  = require("path");
const os    = require("os");
const fs    = require("fs-extra");

// ─── أنواع الصور المدعومة ─────────────────────────────────────
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

/**
 * تحديد هل يوجد صورة في المرفقات أو الرد
 * @param {object} event - حدث الرسالة
 * @returns {{ url: string, type: string }|null}
 */
function detectAttachment(event) {
  // ← صورة مرفقة مباشرة
  const att = event.attachments?.find(a => a.type === "photo" || a.type === "sticker");
  if (att?.url || att?.previewUrl) {
    return { url: att.url || att.previewUrl, type: "image" };
  }

  // ← صورة في رسالة مُقتبسة
  const replyAtt = event.messageReply?.attachments?.find(
    a => a.type === "photo" || a.type === "sticker"
  );
  if (replyAtt?.url || replyAtt?.previewUrl) {
    return { url: replyAtt.url || replyAtt.previewUrl, type: "image" };
  }

  return null;
}

/**
 * تحميل صورة وتحويلها لـ base64
 * @param {string} url - رابط الصورة
 * @returns {Promise<{ data: string, mediaType: string }>}
 */
async function downloadImageAsBase64(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  const contentType = response.headers["content-type"] || "image/jpeg";
  const mediaType   = contentType.split(";")[0].trim();
  const base64Data  = Buffer.from(response.data).toString("base64");

  return { data: base64Data, mediaType };
}

/**
 * الحصول على اسم المُرسِل
 * @param {object} api - Facebook API
 * @param {string} senderID
 * @returns {Promise<string>}
 */
async function getSenderName(api, senderID) {
  try {
    return await new Promise((resolve, reject) => {
      api.getUserInfo(senderID, (err, info) => {
        if (err || !info?.[senderID]) return reject(err || new Error("no info"));
        const u = info[senderID];
        resolve(u.name || u.firstName || "مستخدم");
      });
    });
  } catch (_) {
    return "مستخدم";
  }
}

/**
 * تحميل ملف إلى مجلد مؤقت
 * @param {string} url
 * @param {string} ext - امتداد الملف مثل ".mp3"
 * @returns {Promise<string>} مسار الملف المحلي
 */
async function downloadToTemp(url, ext = ".bin") {
  const tmpPath = path.join(os.tmpdir(), `sunken_${Date.now()}${ext}`);
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 5 * 60 * 1000,
    maxContentLength: 200 * 1024 * 1024,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const writer = fs.createWriteStream(tmpPath);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
  return tmpPath;
}

/**
 * حذف ملف مؤقت بأمان (بدون رمي خطأ)
 * @param {string} filePath
 */
async function removeTempFile(filePath) {
  if (!filePath) return;
  try { await fs.remove(filePath); } catch (_) {}
}

module.exports = {
  detectAttachment,
  downloadImageAsBase64,
  getSenderName,
  downloadToTemp,
  removeTempFile,
  IMAGE_EXT,
};

"use strict";
/**
 * yt.js — بلاجن تحميل صوت YouTube
 * يرسل الرابط لـ HF Space / Render → يستقبل MP3 → يرسله في المجموعة
 *
 * الأوامر:
 *   .yt <رابط>            ← تحميل بجودة 192k افتراضية
 *   .yt <رابط> 320        ← تحميل بجودة 320k
 *   .yt info <رابط>       ← عرض معلومات الفيديو فقط
 */

const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");
const os    = require("os");

const HF_BASE = (process.env.HF_SPACE_URL || "").replace(/\/+$/, "");

// ─── التحقق من رابط YouTube ──────────────────────────────────
const YT_REGEX =
  /https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/|playlist\?list=)|youtu\.be\/)[\w\-]{5,}/i;

function isYoutubeUrl(text) {
  return YT_REGEX.test(text);
}

// ─── استخراج أول رابط YouTube من النص ───────────────────────
function extractUrl(text) {
  const match = text.match(YT_REGEX);
  return match ? match[0] : null;
}

// ─── تنسيق المدة ─────────────────────────────────────────────
function fmtDuration(sec) {
  if (!sec) return "غير معروف";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

// ─── جلب معلومات الفيديو فقط ─────────────────────────────────
async function fetchInfo(url) {
  const { data } = await axios.get(`${HF_BASE}/yt/info`, {
    params: { url },
    timeout: 20000,
  });
  return data;
}

// ─── تحميل الصوت كـ MP3 ──────────────────────────────────────
async function downloadAudio(url, quality = "192") {
  const response = await axios.post(
    `${HF_BASE}/yt/audio`,
    { url, quality },
    {
      responseType: "arraybuffer",   // استقبال الملف كـ binary
      timeout: 5 * 60 * 1000,        // 5 دقائق كحد أقصى
      headers: { "Content-Type": "application/json" },
    }
  );

  // استخراج اسم الملف والمعلومات من الهيدر
  const contentDisp = response.headers["content-disposition"] || "";
  const nameMatch   = contentDisp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i);
  const title       = response.headers["x-title"]    || "audio";
  const duration    = parseInt(response.headers["x-duration"] || "0", 10);
  const uploader    = response.headers["x-uploader"]  || "";
  const fileName    = nameMatch ? decodeURIComponent(nameMatch[1]) : `${title}.mp3`;

  // حفظ الملف مؤقتاً
  const tmpPath = path.join(os.tmpdir(), `yt_${Date.now()}_${fileName}`);
  await fs.writeFile(tmpPath, Buffer.from(response.data));

  return { tmpPath, title, duration, uploader, fileName };
}

// ─── المعالج الرئيسي ─────────────────────────────────────────
async function handle(api, event, args) {
  const { threadID, messageID } = event;

  if (!HF_BASE) {
    return api.sendMessage(
      "❌ HF_SPACE_URL غير مضبوط في متغيرات البيئة.",
      threadID, null, messageID
    );
  }

  const rawText = args.join(" ").trim();

  // ─── أمر المعلومات فقط: .yt info <رابط> ─────────────────
  if (args[0]?.toLowerCase() === "info") {
    const url = extractUrl(rawText);
    if (!url) {
      return api.sendMessage("❌ أرسل رابط YouTube مع الأمر.\nمثال: .yt info https://youtu.be/xxx", threadID, null, messageID);
    }
    try {
      const info = await fetchInfo(url);
      const msg =
        `📺 معلومات الفيديو\n` +
        `━━━━━━━━━━━━━━━\n` +
        `🎵 العنوان: ${info.title || "غير معروف"}\n` +
        `⏱ المدة: ${fmtDuration(info.duration)}\n` +
        `👤 القناة: ${info.uploader || "غير معروف"}\n` +
        `👁 المشاهدات: ${info.view_count?.toLocaleString("ar") || "غير معروف"}\n` +
        `🔗 الرابط: ${url}`;
      return api.sendMessage(msg, threadID, null, messageID);
    } catch (e) {
      return api.sendMessage(`❌ فشل جلب المعلومات: ${e.message?.substring(0, 80)}`, threadID, null, messageID);
    }
  }

  // ─── أمر التحميل: .yt <رابط> [جودة] ────────────────────
  const url = extractUrl(rawText);
  if (!url) {
    return api.sendMessage(
      "❓ كيف تستخدم الأمر:\n\n" +
      "🎵 تحميل MP3:\n" +
      ".yt https://youtu.be/xxx\n" +
      ".yt https://youtu.be/xxx 320  ← جودة أعلى\n\n" +
      "ℹ️ معلومات فقط:\n" +
      ".yt info https://youtu.be/xxx\n\n" +
      "🎚 الجودات المتاحة: 128 / 192 / 256 / 320",
      threadID, null, messageID
    );
  }

  // استخراج الجودة من الأرجومنت (إذا وُجدت)
  const qualityMatch = rawText.match(/\b(128|192|256|320)\b/);
  const quality      = qualityMatch ? qualityMatch[1] : "192";

  // ─── رسالة انتظار ────────────────────────────────────────
  let waitMsgId = null;
  try {
    const sent = await new Promise((res, rej) =>
      api.sendMessage(
        `⏳ جاري التحميل...\n🎚 الجودة: ${quality}k\n🔗 ${url.substring(0, 50)}...`,
        threadID,
        (err, info) => (err ? rej(err) : res(info)),
        messageID
      )
    );
    waitMsgId = sent?.messageID;
  } catch (_) {}

  const updateWait = async (text) => {
    try { if (waitMsgId) await api.editMessage(text, waitMsgId); } catch (_) {}
  };

  // ─── جلب الملف من السيرفر ────────────────────────────────
  let tmpPath = null;
  try {
    await updateWait(`⬇️ يُحمَّل الملف من YouTube...\n🎚 الجودة: ${quality}k`);

    const result = await downloadAudio(url, quality);
    tmpPath = result.tmpPath;

    await updateWait(
      `✅ اكتمل التحميل!\n` +
      `🎵 ${result.title}\n` +
      `⏱ ${fmtDuration(result.duration)}\n` +
      `👤 ${result.uploader}\n\n` +
      `📤 جاري الإرسال...`
    );

    // ─── إرسال الملف الصوتي ──────────────────────────────
    await new Promise((resolve, reject) => {
      api.sendMessage(
        {
          body: `🎵 ${result.title}\n⏱ ${fmtDuration(result.duration)} | 🎚 ${quality}kbps`,
          attachment: fs.createReadStream(tmpPath),
        },
        threadID,
        (err) => (err ? reject(err) : resolve()),
        messageID
      );
    });

    // احذف رسالة الانتظار بعد الإرسال الناجح
    try { if (waitMsgId) api.unsendMessage(waitMsgId, () => {}); } catch (_) {}

  } catch (e) {
    console.error("[YT]", e.message);

    // هل الخطأ من السيرفر ويحتوي على JSON؟
    let errMsg = e.message || "خطأ غير معروف";
    if (e.response?.data) {
      try {
        const errData = JSON.parse(
          Buffer.isBuffer(e.response.data)
            ? e.response.data.toString()
            : JSON.stringify(e.response.data)
        );
        errMsg = errData.error || errMsg;
      } catch (_) {}
    }

    await updateWait(
      `❌ فشل التحميل:\n${errMsg.substring(0, 150)}\n\n` +
      `💡 تأكد أن الفيديو:\n` +
      `• متاح للعموم\n` +
      `• مدته أقل من 50 دقيقة\n` +
      `• ليس محمياً بحقوق النشر`
    );
  } finally {
    // تنظيف الملف المؤقت
    if (tmpPath) {
      fs.unlink(tmpPath).catch(() => {});
    }
  }
}

// ─── تصدير البلاجن ───────────────────────────────────────────
module.exports = {
  config: {
    name:             "yt",
    aliases:          ["ytmp3", "يوتيوب", "ساوند"],
    version:          "1.0.0",
    author:           "Sunken",
    countDown:        10,
    role:             0,
    shortDescription: { ar: "تحميل صوت YouTube بصيغة MP3" },
    longDescription: {
      ar:
        "حمّل أي فيديو من YouTube كملف MP3\n" +
        "الجودات: 128 / 192 / 256 / 320 kbps\n" +
        "الحد الأقصى: 50 دقيقة",
    },
    category: "تحميل",
    guide: {
      ar:
        "{pn}yt <رابط>           ← تحميل (192k افتراضي)\n" +
        "{pn}yt <رابط> 320       ← جودة أعلى\n" +
        "{pn}yt info <رابط>      ← معلومات فقط",
    },
  },

  onStart: async ({ api, event, args }) => {
    await handle(api, event, args);
  },
};

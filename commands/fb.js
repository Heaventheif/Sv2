const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const FDOWN = "https://facebook-video-download-api.onrender.com";

// ─── كشف روابط فيسبوك ────────────────────────────────────────
const FB_REGEX = /https?:\/\/(www\.)?(facebook\.com|fb\.watch|fb\.com)\/(watch|share|reel|video|reels|[\w.]+\/videos?|[\w.]+\/reels?)[^\s]*/i;

function extractFbUrl(text) {
  return text?.match(FB_REGEX)?.[0] || null;
}

// ─── تحميل على /tmp ───────────────────────────────────────────
async function getStream(url) {
  const ext      = url.match(/\.(mp4|webm|mov)/i)?.[1] || "mp4";
  const filePath = path.join(os.tmpdir(), `fb_${Date.now()}.${ext}`);
  const res = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength:    50 * 1024 * 1024,
  });
  const buffer = Buffer.from(res.data);
  if (buffer.length === 0)      throw new Error("الملف فارغ.");
  if (buffer.length > 26214400) throw new Error("الملف أكبر من 25MB.");
  await fs.writeFile(filePath, buffer);
  return { stream: fs.createReadStream(filePath), filePath };
}

async function cleanTemp(filePath) {
  try { if (await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
}

// ─── جلب رابط التحميل ────────────────────────────────────────
async function fetchVideoUrl(fbUrl, quality = "best") {
  const { data } = await axios.post(`${FDOWN}/download`,
    { url: fbUrl, quality },
    { headers: { "Content-Type": "application/json" }, timeout: 30000 }
  );
  return {
    videoUrl: data.download_url || data.available_formats?.[0]?.url || null,
    title:    data.video_info?.title || "فيديو فيسبوك"
  };
}

// ─── دالة التحميل والإرسال (تستخدم api مباشرة) ───────────────
async function downloadAndSend(api, event, fbUrl, quality = "best", label = "") {
  const { threadID, messageID } = event;

  // رسالة انتظار
  const waitInfo = await new Promise(res =>
    api.sendMessage("⏳ جارٍ تحميل الفيديو...", threadID, (e, i) => res(i), messageID)
  );

  const unsendWait = () => {
    if (waitInfo?.messageID)
      try { api.unsendMessage(waitInfo.messageID, () => {}); } catch (_) {}
  };

  try {
    let videoUrl, title;

    if (fbUrl.includes("fbcdn.net") || fbUrl.includes("fdown.isuru.eu.org/stream")) {
      videoUrl = fbUrl;
      title    = "فيديو فيسبوك";
    } else {
      ({ videoUrl, title } = await fetchVideoUrl(fbUrl, quality));
    }

    if (!videoUrl) {
      unsendWait();
      return api.sendMessage("❌ لم يُعثر على الفيديو.", threadID, null, messageID);
    }

    const { stream, filePath } = await getStream(videoUrl);
    unsendWait();

    try {
      await new Promise((res, rej) =>
        api.sendMessage(
          { body: `🎬 ${title}${label}`.trim(), attachment: stream },
          threadID, (e, i) => e ? rej(e) : res(i)
        )
      );
    } finally { await cleanTemp(filePath); }

  } catch (e) {
    unsendWait();
    api.sendMessage(
      "❌ " + (e.response?.data?.message || e.response?.data?.error || e.message),
      threadID, null, messageID
    );
  }
}

module.exports = {
  config: {
    name:      "fb",
    aliases:   ["facebook", "fbdl"],
    version:   "2.0",
    role:      0,
    countDown: 15,
    category:  "download",
    guide: { en: "{pn} <رابط فيسبوك>\n{pn} hd <رابط> — جودة HD\n💡 أو أرسل الرابط مباشرة بدون أمر!" }
  },

  // ─── كشف تلقائي لروابط فيسبوك ───────────────────────────────
  onChat: async ({ api, event, message }) => {
    // 1) رابط في نص الرسالة
    let fbUrl = extractFbUrl(event.body);

    // 2) مشاركة Reels/فيديو مباشرة (زر Share) — الرابط في الـ attachment أو في shareUrl
    if (!fbUrl) {
      for (const att of (event.attachments || [])) {
        const candidate =
          att.url         ||
          att.previewUrl  ||
          att.shareUrl    ||
          att.source      || "";
        fbUrl = extractFbUrl(candidate);
        if (fbUrl) break;
      }
    }

    // 3) فحص messageReply إذا شارك رسالة تحتوي رابط
    if (!fbUrl && event.messageReply?.body) {
      fbUrl = extractFbUrl(event.messageReply.body);
    }

    if (!fbUrl) return;
    await downloadAndSend(api, event, fbUrl, "360p");
  },

  // ─── أمر يدوي ─────────────────────────────────────────────
  onStart: async ({ api, event, args, message }) => {
    if (!args[0]) return message.reply(
      "📥 فيسبوك دونلودر\n\n" +
      ".fb <رابط>      — تحميل عادي\n" +
      ".fb hd <رابط>  — جودة HD\n\n" +
      "💡 أو أرسل رابط فيسبوك مباشرة بدون أمر!"
    );

    const wantHD  = args[0].toLowerCase() === "hd";
    const url     = wantHD ? args[1] : args[0];
    const quality = wantHD ? "720p" : "360p";

    if (!url) return message.reply("❌ أرسل الرابط بعد hd.");

    const fbUrl = extractFbUrl(url) || url;
    await downloadAndSend(api, event, fbUrl, quality, wantHD ? " · HD" : "");
  }
};

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const FDOWN   = "https://facebook-video-download-api.onrender.com";
const MAX_MB  = 25 * 1024 * 1024; // 25MB

// ─── كشف روابط فيسبوك ────────────────────────────────────────
const FB_REGEX = /https?:\/\/(www\.)?(facebook\.com|fb\.watch|fb\.com)\/(watch|share|reel|video|reels|[\w.]+\/videos?|[\w.]+\/reels?)[^\s]*/i;

function extractFbUrl(text) {
  return text?.match(FB_REGEX)?.[0] || null;
}

// ─── تحميل على /tmp مع fallback للدقة ────────────────────────
async function getStream(url) {
  const ext      = url.match(/\.(mp4|webm|mov)/i)?.[1] || "mp4";
  const filePath = path.join(os.tmpdir(), `fb_${Date.now()}.${ext}`);
  const res = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 100 * 1024 * 1024,
    maxBodyLength:    100 * 1024 * 1024,
  });
  const buffer = Buffer.from(res.data);
  if (buffer.length === 0) throw new Error("الملف فارغ.");
  await fs.writeFile(filePath, buffer);
  return { stream: fs.createReadStream(filePath), filePath, size: buffer.length };
}

async function cleanTemp(filePath) {
  try { if (await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
}

// ─── جلب رابط التحميل ────────────────────────────────────────
async function fetchVideoUrl(fbUrl, quality) {
  const { data } = await axios.post(`${FDOWN}/download`,
    { url: fbUrl, quality },
    { headers: { "Content-Type": "application/json" }, timeout: 30000 }
  );
  return {
    videoUrl: data.download_url || data.available_formats?.[0]?.url || null,
    title:    data.video_info?.title || "فيديو فيسبوك"
  };
}

// ─── دالة التحميل مع fallback تلقائي للدقة الأقل ─────────────
// الترتيب: worst → إذا تجاوز 25MB نرفض (worst هي الأدنى)
async function fetchWithFallback(fbUrl, quality) {
  const qualities = quality === "720p"
    ? ["720p", "worst"]   // HD: يحاول 720 ثم worst
    : ["worst"];           // عادي: مباشرة worst

  let lastErr = null;
  for (const q of qualities) {
    try {
      const result = await fetchVideoUrl(fbUrl, q);
      if (result.videoUrl) return result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("لم يُعثر على الفيديو.");
}

// ─── دالة التحميل والإرسال ────────────────────────────────────
async function downloadAndSend(api, event, fbUrl, quality = "worst", label = "") {
  const { threadID, messageID } = event;

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
      ({ videoUrl, title } = await fetchWithFallback(fbUrl, quality));
    }

    if (!videoUrl) {
      unsendWait();
      return api.sendMessage("❌ لم يُعثر على الفيديو.", threadID, null, messageID);
    }

    // ─── تحميل مع فحص الحجم ─────────────────────────────────
    let result = await getStream(videoUrl);

    // إذا تجاوز 25MB وكان quality ليس worst → أعد المحاولة بـ worst
    if (result.size > MAX_MB && quality !== "worst") {
      await cleanTemp(result.filePath);
      unsendWait();
      const waitInfo2 = await new Promise(res =>
        api.sendMessage("⚠️ الحجم كبير، جارٍ تحميل بدقة أقل...", threadID, (e, i) => res(i), messageID)
      );
      const unsend2 = () => {
        if (waitInfo2?.messageID)
          try { api.unsendMessage(waitInfo2.messageID, () => {}); } catch (_) {}
      };
      try {
        const fallback = await fetchVideoUrl(fbUrl, "worst");
        if (!fallback.videoUrl) throw new Error("لا يوجد رابط بديل.");
        result = await getStream(fallback.videoUrl);
        if (result.size > MAX_MB) {
          await cleanTemp(result.filePath);
          unsend2();
          return api.sendMessage("❌ الفيديو كبير جداً حتى بأقل دقة (+25MB).", threadID, null, messageID);
        }
        unsend2();
        label = " · SD";
      } catch (e2) {
        unsend2();
        return api.sendMessage("❌ " + e2.message, threadID, null, messageID);
      }
    } else if (result.size > MAX_MB) {
      await cleanTemp(result.filePath);
      unsendWait();
      return api.sendMessage("❌ الفيديو كبير جداً (+25MB).", threadID, null, messageID);
    }

    unsendWait();
    try {
      await new Promise((res, rej) =>
        api.sendMessage(
          { body: `🎬 ${title}${label}`.trim(), attachment: result.stream },
          threadID, (e, i) => e ? rej(e) : res(i)
        )
      );
    } finally { await cleanTemp(result.filePath); }

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
    version:   "2.1",
    role:      0,
    countDown: 15,
    category:  "download",
    guide: { en: "{pn} <رابط فيسبوك>\n{pn} hd <رابط> — جودة HD\n💡 أو أرسل الرابط مباشرة بدون أمر!" }
  },

  onChat: async ({ api, event }) => {
    let fbUrl = null;
    for (const att of (event.attachments || [])) {
      if (att.type === "share" && att.url) { fbUrl = att.url; break; }
    }
    if (!fbUrl) fbUrl = extractFbUrl(event.body);
    if (!fbUrl && event.messageReply?.body) fbUrl = extractFbUrl(event.messageReply.body);
    if (!fbUrl) return;
    await downloadAndSend(api, event, fbUrl, "worst");
  },

  onStart: async ({ api, event, args, message }) => {
    if (!args[0]) return message.reply(
      "📥 فيسبوك دونلودر\n\n" +
      ".fb <رابط>      — تحميل عادي\n" +
      ".fb hd <رابط>  — جودة HD\n\n" +
      "💡 أو أرسل رابط فيسبوك مباشرة بدون أمر!"
    );
    const wantHD  = args[0].toLowerCase() === "hd";
    const url     = wantHD ? args[1] : args[0];
    const quality = wantHD ? "720p" : "worst";
    if (!url) return message.reply("❌ أرسل الرابط بعد hd.");
    const fbUrl = extractFbUrl(url) || url;
    await downloadAndSend(api, event, fbUrl, quality, wantHD ? " · HD" : "");
  }
};

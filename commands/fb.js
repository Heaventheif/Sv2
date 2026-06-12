const axios  = require("axios");
const fs     = require("fs-extra");
const os     = require("os");
const path   = require("path");

const FDOWN = "https://facebook-video-download-api.onrender.com";

// ─── تحميل على /tmp وإرجاع ReadStream (نفس نمط yt.js) ────────
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

function safeUnsend(message, wait) {
  const id = wait?.messageID || wait;
  if (!id) return;
  try {
    if (typeof message.unsend === "function") message.unsend(id);
    else if (global.botApi?.unsendMessage) global.botApi.unsendMessage(id);
  } catch (_) {}
}

// ─── جلب رابط التحميل من fdown ───────────────────────────────
async function fetchVideoUrl(fbUrl, quality = "best") {
  const { data } = await axios.post(`${FDOWN}/download`,
    { url: fbUrl, quality },
    { headers: { "Content-Type": "application/json" }, timeout: 30000 }
  );
  // response: { status, download_url, video_info: { title, ... }, available_formats }
  const videoUrl = data.download_url
    || data.available_formats?.[0]?.url
    || null;
  const title = data.video_info?.title || "فيديو فيسبوك";
  return { videoUrl, title };
}

module.exports = {
  config: {
    name:      "fb",
    aliases:   ["facebook", "fbdl"],
    version:   "1.1",
    role:      0,
    countDown: 15,
    category:  "download",
    guide: { en: "{pn} <رابط فيسبوك>\n{pn} hd <رابط>  — جودة عالية" }
  },

  onStart: async ({ message, args }) => {
    if (!args[0]) return message.reply(
      "❌ أرسل رابط فيسبوك.\n\n" +
      "مثال:\n" +
      ".fb https://www.facebook.com/watch?v=xxx\n" +
      ".fb https://fb.watch/xxx\n" +
      ".fb hd <رابط>  — جودة HD"
    );

    const sub      = args[0].toLowerCase();
    const wantHD   = sub === "hd";
    const url      = wantHD ? args[1] : args[0];
    const quality  = wantHD ? "720p" : "best";

    if (!url) return message.reply("❌ أرسل الرابط بعد hd.");

    const wait = await message.reply("⏳ جارٍ تحميل الفيديو...");

    try {
      // ── رابط CDN مباشر ────────────────────────────────────
      if (url.includes("fbcdn.net") || url.includes("fdown.isuru.eu.org/stream")) {
        const { stream, filePath } = await getStream(url);
        safeUnsend(message, wait);
        try {
          await message.reply({ body: "🎬 فيديو فيسبوك", attachment: stream });
        } finally { await cleanTemp(filePath); }
        return;
      }

      // ── رابط فيسبوك عادي → fdown API ──────────────────────
      const { videoUrl, title } = await fetchVideoUrl(url, quality);

      if (!videoUrl) {
        safeUnsend(message, wait);
        return message.reply("❌ لم يُعثر على الفيديو.");
      }

      const { stream, filePath } = await getStream(videoUrl);
      safeUnsend(message, wait);
      try {
        await message.reply({
          body:       `🎬 ${title}${wantHD ? " · HD" : ""}`.trim(),
          attachment: stream
        });
      } finally { await cleanTemp(filePath); }

    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.message || e.response?.data?.error || e.message));
    }
  }
};

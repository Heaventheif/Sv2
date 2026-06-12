const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

// رابط HF Space من متغيرات البيئة (HF_SPACE_URL) + مسار /fbdl
const BASE = `${(process.env.HF_SPACE_URL || "").replace(/\/$/, "")}/fbdl`;

// ─── تحميل الملف على /tmp ثم إرساله كـ ReadStream ────────────
async function getStream(url) {
  const filePath = path.join(os.tmpdir(), `fb_${Date.now()}.mp4`);

  const res = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 26214400,
    maxBodyLength:    26214400,
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

// ─── حذف رسالة الانتظار بأمان ────────────────────────────────
function safeUnsend(message, wait) {
  const id = wait?.messageID || wait;
  if (!id) return;
  try {
    if (typeof message.unsend === "function") message.unsend(id);
    else if (global.botApi?.unsendMessage) global.botApi.unsendMessage(id);
  } catch (_) {}
}

// ─── استخراج رابط فيسبوك من الرسالة ───────────────────────────
function extractFacebookUrl(text) {
  const match = text.match(/https?:\/\/[^\s]*(facebook\.com|fb\.watch|fb\.gg)[^\s]*/i);
  return match ? match[0] : null;
}

module.exports = {
  config: {
    name:      "fbdl",
    aliases:   ["fb", "facebook"],
    version:   "1.0",
    role:      0,
    countDown: 15,
    category:  "download",
    guide: { en:
      "{pn} <رابط فيديو فيسبوك>  — تحميل الفيديو وإرساله"
    }
  },

  // ─── onStart ──────────────────────────────────────────────────
  onStart: async ({ message, args }) => {
    if (!process.env.HF_SPACE_URL) return message.reply("❌ متغير HF_SPACE_URL غير مضبوط في البيئة.");

    const query = args.join(" ").trim();
    const url   = extractFacebookUrl(query);

    if (!url) return message.reply(
      "📥 فيسبوك دونلودر\n\n" +
      "🔗 fbdl <رابط فيديو فيسبوك>\n" +
      "مثال: fbdl https://www.facebook.com/share/v/xxxxxxx"
    );

    const wait = await message.reply("⏳ جارٍ جلب الفيديو من فيسبوك...");

    try {
      const res  = await axios.get(BASE, {
        params:  { url },
        timeout: 60000,
      });
      const data = res.data;

      if (data?.error) {
        safeUnsend(message, wait);
        return message.reply(`❌ ${data.error}`);
      }

      const downloadUrl = data?.links?.download_url;
      if (!downloadUrl) {
        safeUnsend(message, wait);
        return message.reply("❌ لم يتم العثور على رابط تحميل صالح.");
      }

      const { stream, filePath } = await getStream(downloadUrl);
      safeUnsend(message, wait);

      try {
        await message.reply({
          body:       `🎬 ${data.title || "فيديو فيسبوك"}`,
          attachment: stream
        });
      } finally { await cleanTemp(filePath); }

    } catch (e) {
      safeUnsend(message, wait);
      message.reply("❌ " + (e.response?.data?.error || e.message));
    }
  }
};

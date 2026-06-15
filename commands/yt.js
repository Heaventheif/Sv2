"use strict";

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const BASE = "https://yt-dlp-stream.onrender.com/api";

// ─── 7 أزواج إيموجي (mp3, mp4) ────────────────────────────────
const EMOJI_PAIRS = [
  ["👍", "❤️"], ["😆", "😮"], ["😢", "😡"],
  ["🥰", "👏"], ["🔥", "💯"], ["😍", "😭"], ["🤔", "👀"],
];

// ═══════════════════════════════════════════════════════════════
// 🕺 ستيكرز الرقص — مزيج من أنمي + ميمز + فيسبوك الرسمية
// ═══════════════════════════════════════════════════════════════
// كل معرّف تحقق منه على فيسبوك ماسنجر ويُرسَل كـ { sticker: ID }
const DANCE_STICKERS = [
  // ─── Felix the Cat (رسمي فيسبوك) ─────────────────────────
  369239263222822,   // 👍 (fallback معروف يعمل دائماً)

  // ─── Meep (رسمي فيسبوك) ──────────────────────────────────
  1476919779177967,  // Meep رقص
  1476919775844634,  // Meep يتحرك
  1476919769177968,  // Meep فرحان
  1476919782511300,  // Meep موسيقى

  // ─── Pusheen رقص ─────────────────────────────────────────
  858796277557862,   // Pusheen رقص
  858796324224524,   // Pusheen يتمايل
  858796340891189,   // Pusheen موسيقى

  // ─── Stickman ─────────────────────────────────────────────
  1511819158906996,
  1511819155573663,
  1511819152240330,

  // ─── UglyDolls ────────────────────────────────────────────
  1616924261895369,
  1616924258562036,

  // ─── ستيكرز ميمز شهيرة على فيسبوك ───────────────────────
  767260996730039,   // الرجل الراقص الشهير
  767260986730040,
  1109048629207137,
  2219397278275076,
  2219397274941743,

  // ─── أنمي / كيوت ──────────────────────────────────────────
  1527143324258607,
  1527143320925274,
  874028806056063,
  874028802722730,
  874028799389397,
];

// ─── اختيار عشوائي من القائمة ─────────────────────────────────
function randomDanceSticker() {
  return DANCE_STICKERS[Math.floor(Math.random() * DANCE_STICKERS.length)];
}

// ─── إرسال ستيكر رقص (بدون try/catch خارجي — لا نريد إيقاف الكود) ──
async function sendDanceSticker(api, threadID) {
  try {
    await new Promise((resolve, reject) =>
      api.sendMessage(
        { sticker: randomDanceSticker() },
        threadID,
        (err) => err ? reject(err) : resolve()
      )
    );
  } catch (err) {
    // إذا فشل الستيكر الأول جرب آخر
    try {
      await new Promise((resolve) =>
        api.sendMessage({ sticker: 369239263222822 }, threadID, resolve)
      );
    } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════════════════
// تحميل الملف على /tmp ثم إرساله كـ ReadStream
// ═══════════════════════════════════════════════════════════════
async function getStream(url) {
  const ext      = url.match(/\.(mp4|mp3|webm|m4a)/i)?.[1] || "mp3";
  const filePath = path.join(os.tmpdir(), `yt_${Date.now()}.${ext}`);

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

// ─── v2: جلب روابط التحميل ────────────────────────────────────
async function v2(query) {
  const url  = `${BASE}/v2/q?=${encodeURIComponent(query)}`;
  const res  = await axios.get(url, { timeout: 30000 });
  const data = res.data;
  if (Array.isArray(data)) return data[0] || {};
  if (!data || typeof data !== "object") return {};
  return data;
}

// ─── v3: بحث وإعادة قائمة ─────────────────────────────────────
async function v3(query, limit = 8) {
  const url  = `${BASE}/v3/q?=${encodeURIComponent(query)}&?=${limit}`;
  const res  = await axios.get(url, { timeout: 25000 });
  const data = res.data;
  if (Array.isArray(data))               return { results: data };
  if (!data || typeof data !== "object") return { results: [] };
  if (Array.isArray(data.results))       return data;
  if (Array.isArray(data.data))          return { results: data.data };
  return { results: [] };
}

// ─── استخرج روابط من v2 response ──────────────────────────────
function parse(d) {
  if (!d || typeof d !== "object") return {
    title: "بدون عنوان", author: "", mp4Url: null, mp3Url: null
  };
  const m = (d.media && typeof d.media === "object" && !Array.isArray(d.media)) ? d.media : {};
  function getUrl(f) {
    if (!f) return null;
    if (typeof f === "string") return f;
    if (typeof f === "object" && typeof f.url === "string") return f.url;
    return null;
  }
  return {
    title:  d.title  || "بدون عنوان",
    author: d.author || d.channel || "",
    mp4Url: getUrl(m.mp4) || getUrl(d.mp4) || null,
    mp3Url: getUrl(m.mp3) || getUrl(d.mp3) || null,
  };
}

// ═══════════════════════════════════════════════════════════════
// تحميل وإرسال + ستيكر رقص بعد الإرسال
// ═══════════════════════════════════════════════════════════════
async function downloadAndSend(message, statusMsgId, query, wantMp4, api, threadID) {
  const updateStatus = async (text) => {
    try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
  };

  const p   = parse(await v2(query));
  const url = wantMp4 ? p.mp4Url : p.mp3Url;

  if (!url) {
    return updateStatus(`❌ الرابط غير متاح.\n💡 جرّب النوع الآخر.`);
  }

  const { stream, filePath } = await getStream(url);
  try {
    // ── إرسال الملف الصوتي/المرئي ─────────────────────────
    await new Promise((resolve, reject) => {
      api.sendMessage(
        {
          body:       `${wantMp4 ? "🎬" : "🎵"} ${p.title}\n📺 ${p.author}`.trim(),
          attachment: stream
        },
        threadID,
        (err) => err ? reject(err) : resolve()
      );
    });

    // ── حذف رسالة الانتظار ────────────────────────────────
    if (statusMsgId) {
      try { await api.unsendMessage(statusMsgId); } catch (_) {}
    }

    // 🕺 ── إرسال ستيكر رقص عشوائي بدلاً من الصمت ─────────
    await sendDanceSticker(api, threadID);

  } finally {
    await cleanTemp(filePath);
  }
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:      "yt",
    aliases:   ["ytdl", "youtube", "mp3", "mp4", "yts"],
    version:   "3.1",          // ← رُقِّم للتمييز
    role:      0,
    countDown: 15,
    category:  "download",
    guide: { en:
      "{pn} <اسم>         — بحث وعرض قائمة\n" +
      "{pn} mp4 <اسم>     — بحث وعرض قائمة (فيديو)\n" +
      "{pn} <رابط>        — تحميل مباشر MP3\n" +
      "{pn} mp4 <رابط>   — تحميل مباشر MP4"
    }
  },

  // ─── onStart ────────────────────────────────────────────────
  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 yt <اسم أغنية>    — بحث وقائمة\n" +
      "🎬 yt mp4 <اسم>      — بحث وقائمة فيديو\n" +
      "🔗 yt <رابط>         — تحميل مباشر"
    );

    const sub     = args[0].toLowerCase();
    const wantMp4 = sub === "mp4";
    const hasFlag = ["mp4", "mp3"].includes(sub);
    const query   = (hasFlag ? args.slice(1) : args).join(" ").trim();

    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");

    // ── رابط مباشر → تحميل فوري ────────────────────────────
    const isUrl = query.startsWith("http://") || query.startsWith("https://");
    if (isUrl) {
      let statusMsgId = null;
      try {
        const sent = await new Promise((resolve, reject) =>
          api.sendMessage(
            `⏳ ${wantMp4 ? "🎬 جارٍ تحميل الفيديو..." : "🎵 جارٍ تحميل الصوت..."}`,
            threadID,
            (err, info) => err ? reject(err) : resolve(info),
            messageID
          )
        );
        statusMsgId = sent?.messageID;
      } catch (_) {}

      try {
        await downloadAndSend(message, statusMsgId, query, wantMp4, api, threadID);
      } catch (e) {
        try { if (statusMsgId) await api.editMessage("❌ " + (e.response?.data?.error || e.message), statusMsgId); } catch (_) {}
      }
      return;
    }

    // ── اسم أغنية → بحث وعرض قائمة ────────────────────────
    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(
          `🔍 جارٍ البحث عن "${query}"...`,
          threadID,
          (err, info) => err ? reject(err) : resolve(info),
          messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    try {
      const res = await v3(query, 7);
      if (!res.results?.length) return updateStatus("❌ لم تُعثر على نتائج.");

      const results = res.results.slice(0, 7);
      let text = `🎵 نتائج البحث:\n─────────────────\n`;
      results.forEach((v, i) => {
        const [mp3Emoji, mp4Emoji] = EMOJI_PAIRS[i];
        text += `${i + 1}. ${v.title}\n   ⏱ ${v.duration || "--"}\n   ${mp3Emoji} mp3  |  ${mp4Emoji} mp4\n─────────────────\n`;
      });
      text += `🔢 رُد بالرقم، أو تفاعل بإيموجي مناسب (mp3/mp4)\n⏳ تنتهي بعد دقيقتين.`;

      await updateStatus(text);

      if (statusMsgId) {
        const session = {
          commandName: "yt",
          author:      event.senderID,
          results,
          wantMp4,
          statusMsgId,
          timestamp:   Date.now()
        };

        global.Kagenou.replies[statusMsgId] = session;

        global.client.reactionListener[statusMsgId] = {
          author: event.senderID,
          callback: async ({ api, event: reactEvent }) => {
            const reaction = reactEvent.reaction;
            const idx = EMOJI_PAIRS.findIndex(([mp3, mp4]) => reaction === mp3 || reaction === mp4);
            if (idx === -1 || idx >= results.length) return;

            const wantMp4Reaction = reaction === EMOJI_PAIRS[idx][1];
            const chosen = results[idx];

            delete global.client.reactionListener[statusMsgId];
            delete global.Kagenou.replies[statusMsgId];

            await updateStatus(`⏳ جارٍ تحميل: ${chosen.title}...`);
            try {
              await downloadAndSend(message, statusMsgId, chosen.url || chosen.short_url, wantMp4Reaction, api, threadID);
            } catch (e) {
              await updateStatus("❌ " + (e.response?.data?.error || e.message));
            }
          }
        };

        setTimeout(() => {
          if (global.client.reactionListener[statusMsgId])
            delete global.client.reactionListener[statusMsgId];
        }, 120000);
      }
    } catch (e) {
      await updateStatus("❌ " + (e.response?.data?.error || e.message));
    }
  },

  // ─── onReply: المستخدم يختار رقماً ─────────────────────────
  onReply: async ({ api, event, Reply, message }) => {
    if (event.senderID !== Reply.author || !Reply.results) return;

    const { threadID } = event;
    const parts   = event.body?.trim().split(/\s+/) || [];
    const idx     = parseInt(parts[0]) - 1;
    const wantMp4 = parts[1]?.toLowerCase() === "mp4"
      ? true
      : parts[1]?.toLowerCase() === "mp3"
        ? false
        : Reply.wantMp4 ?? false;

    if (isNaN(idx) || idx < 0 || idx >= Reply.results.length)
      return message.reply(`❌ أرسل رقماً من 1 إلى ${Reply.results.length}`);

    const chosen      = Reply.results[idx];
    const statusMsgId = Reply.statusMsgId;

    delete global.client.reactionListener[statusMsgId];
    delete global.Kagenou.replies[statusMsgId];

    const updateStatus = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    await updateStatus(`⏳ جارٍ تحميل: ${chosen.title}...`);

    try {
      await downloadAndSend(message, statusMsgId, chosen.url || chosen.short_url, wantMp4, api, threadID);
    } catch (e) {
      await updateStatus("❌ " + (e.response?.data?.error || e.message));
    }
  }
};

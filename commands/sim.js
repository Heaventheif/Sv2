"use strict";

const axios = require("axios");

// ─── حالة التشغيل لكل مجموعة ────────────────────────────────────
if (!global.simActive) global.simActive = {};

// ─── كشف اللغة (عربي أو إنجليزي) ────────────────────────────────
function detectLang(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return arabicChars > 0 ? "ar" : "en";
}

// ─── استدعاء SimSimi API ─────────────────────────────────────────
async function askSimSimi(text) {
  const lc = detectLang(text);
  const res = await axios.post(
    "https://api.simsimi.vn/v1/simtalk",
    new URLSearchParams({ text, lc, key: "" }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    }
  );
  const msg = res.data?.message;
  if (!msg || res.data?.status === "400") return null;
  return msg;
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:        "sim",
    aliases:     ["simsimi", "سيم"],
    version:     "1.0",
    role:        0,
    countDown:   3,
    category:    "fun",
    description: "تشغيل/إيقاف بوت المحادثة SimSimi في المجموعة — يدعم العربي والإنجليزي",
    guide: { en: "{pn} on — تشغيل\n{pn} off — إيقاف" },
  },

  // ─── أمر التشغيل/الإيقاف ──────────────────────────────────────
  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID } = event;
    const sub = args[0]?.toLowerCase();

    if (sub === "on") {
      global.simActive[threadID] = true;
      return message.reply("✅ SimSimi شغّال الآن — كلمني!");
    }

    if (sub === "off") {
      global.simActive[threadID] = false;
      return message.reply("🔴 SimSimi متوقف.");
    }

    // حالة بدون args — أظهر الحالة الحالية
    const status = global.simActive[threadID] ? "🟢 شغّال" : "🔴 متوقف";
    return message.reply(
      `🤖 SimSimi — الحالة: ${status}\n\n` +
      `.sim on  — تشغيل\n` +
      `.sim off — إيقاف`
    );
  },

  // ─── يستمع لكل رسالة في المجموعة ─────────────────────────────
  onChat: async ({ api, event }) => {
    const { threadID, senderID, body, messageID } = event;

    // تجاهل إذا مطفي أو الرسالة فارغة أو من البوت نفسه
    if (!global.simActive[threadID]) return;
    if (!body?.trim()) return;

    // تجاهل الأوامر التي تبدأ بـ .
    if (body.trim().startsWith(".")) return;

    try {
      const reply = await askSimSimi(body.trim());

      if (!reply) return; // SimSimi ما عنده رد

      await new Promise((res, rej) =>
        api.sendMessage(reply, threadID, err => err ? rej(err) : res(), messageID)
      );
    } catch (err) {
      // تجاهل الأخطاء الصامتة في onChat
      console.error("[sim] خطأ:", err.message);
    }
  },
};

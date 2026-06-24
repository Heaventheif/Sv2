"use strict";

const axios = require("axios");

// ─── حالة التشغيل لكل مجموعة ────────────────────────────────────
if (!global.simActive) global.simActive = {};

// ─── كشف اللغة (عربي أو إنجليزي) ────────────────────────────────
function detectLang(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return arabicChars > 0 ? "ar" : "en";
}

// ─── طلب احتياطي عبر https الأصلي في Node — يتجاوز axios كلياً ──────
// يُستخدم فقط إذا أعاد axios نفسه HTTP 411، لأن هذا الخطأ تحديداً معروف
// بحدوثه بسبب سلوك adapter الخاص بـ axios في بعض بيئات الاستضافة
// (containers/serverless) حتى مع ضبط Content-Length يدوياً — استخدام
// https.request مباشرة يعطينا تحكماً كاملاً 100% في الترويسة المُرسلة.
function postFormRaw(urlString, bodyString, timeoutMs) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    const { URL } = require("url");
    const u = new URL(urlString);

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(bodyString),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          resolve({ status: res.statusCode, raw: chunks });
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.write(bodyString);
    req.end();
  });
}

// ─── استدعاء SimSimi API ─────────────────────────────────────────
async function askSimSimi(text) {
  const lc = detectLang(text);
  // ملاحظة مهمة: تمرير URLSearchParams مباشرة كـ body كان يسبب HTTP 411
  // (Length Required) لأن axios لم يكن يحسب Content-Length بشكل موثوق منه.
  // التحويل لنص صريح (.toString()) يضمن أن axios يحسب الطول الصحيح دائماً.
  const body = new URLSearchParams({ text, lc, key: "" }).toString();

  let res;
  try {
    res = await axios.post(
      "https://api.simsimi.vn/v1/simtalk",
      body,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 15000,
        validateStatus: () => true, // نريد فحص الحالة بأنفسنا، لا أن axios يرمي استثناءً صامتاً
      }
    );
  } catch (err) {
    console.error("[sim] فشل شبكة عند استدعاء SimSimi (axios):", err.message);
    throw new Error(`فشل الاتصال بـ SimSimi: ${err.message}`);
  }

  // إذا استمر axios بإعادة 411 رغم ضبط Content-Length يدوياً، هذا يعني أن
  // adapter الخاص به في هذه البيئة هو المشكلة فعلاً — نتجاوزه كلياً بطلب https خام
  if (res.status === 411) {
    console.error("[sim] axios رجع 411 رغم Content-Length الصريح — تجربة https الأصلي بدلاً منه");
    try {
      const raw = await postFormRaw("https://api.simsimi.vn/v1/simtalk", body, 15000);
      if (raw.status !== 200) {
        console.error(`[sim] https الأصلي رجع HTTP ${raw.status} أيضاً:`, raw.raw.slice(0, 300));
        throw new Error(`SimSimi رجع HTTP ${raw.status} (حتى بعد تجاوز axios)`);
      }
      let data;
      try {
        data = JSON.parse(raw.raw);
      } catch {
        console.error("[sim] رد https الأصلي غير JSON صالح:", raw.raw.slice(0, 300));
        return null;
      }
      res = { status: raw.status, data };
    } catch (e) {
      console.error("[sim] فشل https الأصلي أيضاً:", e.message);
      throw e;
    }
  } else if (res.status !== 200) {
    console.error(`[sim] SimSimi رجع HTTP ${res.status}:`, JSON.stringify(res.data).slice(0, 300));
    throw new Error(`SimSimi رجع HTTP ${res.status}`);
  }

  const data = res.data;
  const msg = data?.message;

  // status من الـ API نفسه يأتي كنص ("200", "400"...) — وليس فقط "400" يعني خطأ،
  // أي قيمة غير "200" تُعامل كخطأ غير متوقع بدل تمريرها بصمت
  if (data?.status && data.status !== "200") {
    console.error(`[sim] SimSimi رجع status=${data.status}:`, JSON.stringify(data).slice(0, 300));
    return null;
  }

  if (!msg) {
    // شكل استجابة غير متوقع كلياً (لا message ولا status معروف) — سجّل الاستجابة
    // الكاملة لتشخيص أي تغيّر مستقبلي في شكل الـ API بسهولة
    console.error("[sim] استجابة غير متوقعة من SimSimi:", JSON.stringify(data).slice(0, 300));
    return null;
  }

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
      `sim on  — تشغيل\n` +
      `sim off — إيقاف`
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

      if (!reply) return; // SimSimi نفسه رد بأنه لا يعرف إجابة — هذا طبيعي، لا تنبيه

      await new Promise((res, rej) =>
        api.sendMessage(reply, threadID, err => err ? rej(err) : res(), messageID)
      );

      // نجاح — صفّر عدّاد الأخطاء المتتالية لهذه المجموعة
      if (global.simFailCount) global.simFailCount[threadID] = 0;
    } catch (err) {
      // خطأ فعلي (شبكة/HTTP/استجابة غير متوقعة) — هذا ليس "لا رد طبيعي"، لذلك
      // نتتبعه وننبّه المجموعة مرة واحدة فقط بعد عدة فشل متتالي، بدل الصمت
      // الكامل الذي يجعل الأمر يبدو كأن البوت معطّل دون أي تفسير.
      console.error("[sim] خطأ:", err.message);

      if (!global.simFailCount) global.simFailCount = {};
      global.simFailCount[threadID] = (global.simFailCount[threadID] || 0) + 1;

      if (global.simFailCount[threadID] === 3) {
        api.sendMessage(
          "⚠️ SimSimi يواجه مشكلة في الاتصال حالياً (قد تكون مشكلة مؤقتة بالخدمة الخارجية). جاري المحاولة، لكن إذا استمرت المشكلة جرّب لاحقاً.",
          threadID
        );
      }
    }
  },
};

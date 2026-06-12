/* session-guard.js
 * ─────────────────────────────────────────────────────────────
 * يراقب صحة الجلسة ويعيد تسجيل الدخول تلقائياً عند انتهائها
 * ثم يحدّث متغير APPSTATE في Render فقط — بدون مس أي متغير آخر
 *
 * المتغيرات البيئية المطلوبة:
 *   FB_EMAIL          — إيميل حساب فيسبوك
 *   FB_PASSWORD       — كلمة مرور الحساب
 *   RENDER_API_KEY    — API key من render (Account → API Keys)
 *   RENDER_SERVICE_ID — معرف الـ service (من URL: dashboard/services/srv-xxxx)
 * ─────────────────────────────────────────────────────────────
 */

"use strict";

const axios   = require("axios");
const login   = require("@anbuinfosec/fca-unofficial");
const fs      = require("fs-extra");
const path    = require("path");
const chalk   = require("chalk");

// ─── إعدادات ──────────────────────────────────────────────────
const CHECK_INTERVAL   = 5  * 60 * 1000;  // فحص كل 5 دقائق
const RETRY_DELAY      = 30 * 1000;       // انتظر 30 ثانية قبل إعادة المحاولة
const MAX_RETRIES      = 3;               // أقصى عدد محاولات لإعادة الدخول
const APPSTATE_PATH    = path.join(__dirname, "appstate.json");
const RENDER_API_BASE  = "https://api.render.com/v1";

// ─── حالة داخلية ──────────────────────────────────────────────
let _api           = null;
let _opts          = {};
let _isRefreshing  = false;
let _failCount     = 0;
let _checkTimer    = null;

// ─── تسجيل ────────────────────────────────────────────────────
const log = {
  info:  m => console.log(chalk.blue  ("[SESSION]"), m),
  ok:    m => console.log(chalk.green ("[SESSION]"), m),
  warn:  m => console.log(chalk.yellow("[SESSION]"), m),
  error: m => console.log(chalk.red   ("[SESSION]"), m),
};

// ─── فحص صحة الجلسة ──────────────────────────────────────────
async function isSessionAlive(api) {
  return new Promise((resolve) => {
    api.getThreadList(1, null, ["INBOX"], (err, threads) => {
      resolve(!err && Array.isArray(threads));
    });
  });
}

// ─── تحديث APPSTATE في Render فقط ────────────────────────────
async function updateRenderEnv(newAppState) {
  const apiKey     = process.env.RENDER_API_KEY;
  const serviceId  = process.env.RENDER_SERVICE_ID;

  if (!apiKey || !serviceId) {
    log.warn("RENDER_API_KEY أو RENDER_SERVICE_ID غير موجودَين — لن يُحدَّث Render");
    return false;
  }

  try {
    // 1) اجلب المتغيرات الحالية كلها
    const { data: current } = await axios.get(
      `${RENDER_API_BASE}/services/${serviceId}/env-vars`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
    );

    // current = [ { envVar: { key, value } }, ... ]
    const envList = (current || []).map(e => e.envVar || e);

    // 2) ابنِ القائمة الجديدة: غيّر APPSTATE فقط، ابقِ الباقي كما هو
    const updated = envList.map(v => ({
      key:   v.key,
      value: v.key === "APPSTATE" ? JSON.stringify(newAppState) : v.value,
    }));

    // إذا لم يكن APPSTATE موجوداً أصلاً، أضفه
    if (!updated.find(v => v.key === "APPSTATE")) {
      updated.push({ key: "APPSTATE", value: JSON.stringify(newAppState) });
    }

    // 3) أرسل القائمة كاملة (PUT يستبدل الكل — لكننا أعدنا كل المتغيرات)
    await axios.put(
      `${RENDER_API_BASE}/services/${serviceId}/env-vars`,
      updated,
      { headers: {
          Authorization:  `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept:         "application/json",
      }}
    );

    log.ok("✅ تم تحديث APPSTATE في Render بنجاح");
    return true;
  } catch (e) {
    log.error(`فشل تحديث Render: ${e.response?.data?.message || e.message}`);
    return false;
  }
}

// ─── إعادة تسجيل الدخول ──────────────────────────────────────
async function reLogin() {
  const email    = process.env.FB_EMAIL;
  const password = process.env.FB_PASSWORD;

  if (!email || !password) {
    log.error("FB_EMAIL أو FB_PASSWORD غير موجودَين — لا يمكن إعادة الدخول");
    return null;
  }

  log.info(`🔄 إعادة تسجيل الدخول بـ ${email} ...`);

  return new Promise((resolve) => {
    login({ email, password }, async (err, newApi) => {
      if (err) {
        log.error(`فشل تسجيل الدخول: ${err.message || err}`);
        return resolve(null);
      }

      const newState = newApi.getAppState();
      log.ok("✅ تم تسجيل الدخول بنجاح — جلسة جديدة");

      // احفظ محلياً
      try {
        fs.writeFileSync(APPSTATE_PATH, JSON.stringify(newState, null, 2), "utf8");
        log.ok("💾 تم حفظ appstate.json");
      } catch (e) {
        log.warn(`فشل حفظ appstate.json: ${e.message}`);
      }

      // حدّث Render
      await updateRenderEnv(newState);

      // حدّث global.appState
      global.appState = newState;

      resolve(newApi);
    });
  });
}

// ─── دورة الفحص ──────────────────────────────────────────────
async function checkSession() {
  if (_isRefreshing || !_api) return;

  const alive = await isSessionAlive(_api);

  if (alive) {
    _failCount = 0;
    return; // كل شيء بخير
  }

  _failCount++;
  log.warn(`⚠️ الجلسة لا تستجيب (محاولة ${_failCount}/${MAX_RETRIES})`);

  if (_failCount < MAX_RETRIES) return; // انتظر المزيد قبل القرار

  // وصلنا حد الإخفاقات — أعد الدخول
  _isRefreshing = true;
  _failCount    = 0;

  // أخطر المشرف
  if (_opts.onSuspended) _opts.onSuspended("الجلسة انتهت — جارٍ إعادة الدخول...");

  let retries = 0;
  let newApi  = null;

  while (retries < MAX_RETRIES && !newApi) {
    retries++;
    if (retries > 1) {
      log.info(`⏳ انتظار ${RETRY_DELAY / 1000}ث قبل المحاولة ${retries}...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    }
    newApi = await reLogin();
  }

  if (newApi) {
    // أعِد تطبيق الإعدادات على الـ api الجديد
    newApi.setOptions({
      forceLogin:       true,
      listenEvents:     true,
      updatePresence:   false,
      selfListen:       false,
      online:           true,
      autoMarkDelivery: false,
      autoMarkRead:     false,
      listenTyping:     false,
    });

    _api           = newApi;
    global.botApi  = newApi;

    log.ok("🎉 تم استعادة الجلسة — إعادة تشغيل المستمع...");
    if (_opts.onRestored) _opts.onRestored(newApi);
  } else {
    log.error("❌ فشلت كل محاولات إعادة الدخول");
    if (_opts.onFailed) _opts.onFailed();
  }

  _isRefreshing = false;
}

// ─── واجهة عامة ──────────────────────────────────────────────
module.exports = {
  /**
   * init(api, opts)
   * opts: {
   *   onSuspended(msg)  — عند اكتشاف انتهاء الجلسة
   *   onRestored(newApi)— بعد استعادتها بنجاح
   *   onFailed()        — إذا فشلت كل المحاولات
   * }
   */
  init(api, opts = {}) {
    _api  = api;
    _opts = opts;

    log.ok("🛡️ session-guard نشط — فحص كل 5 دقائق");

    // أوقف أي timer سابق
    if (_checkTimer) clearInterval(_checkTimer);
    _checkTimer = setInterval(checkSession, CHECK_INTERVAL);

    // فحص فوري بعد دقيقة من البدء
    setTimeout(checkSession, 60_000);
  },

  // لتحديث الـ api بعد restart يدوي
  setApi(api) { _api = api; },

  // لاستدعاء تحديث Render يدوياً
  updateRenderEnv,
};

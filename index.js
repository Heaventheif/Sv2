/* jshint esversion: 11 */
"use strict";

// ════════════════════════════════════════════════════════════
//  🔐 بيانات الدخول — يُفضَّل وضعها في .env أو Render Variables
//  اترك القيم الافتراضية إذا كنت تستخدم appstate.json فقط
// ════════════════════════════════════════════════════════════
try { require("dotenv").config(); } catch (_) {}

const FB_EMAIL      = process.env.FB_EMAIL      || "";
const FB_PASSWORD   = process.env.FB_PASSWORD   || "";
const FB_2FA_SECRET = process.env.FB_2FA_SECRET || "";

// ─── منع EPIPE وأخطاء الشبكة من إسقاط البوت ──────────────────
const IGNORED_CODES = new Set(["EPIPE", "ECONNRESET", "ETIMEDOUT"]);
process.on("uncaughtException",  (err) => { if (!IGNORED_CODES.has(err.code)) console.error("[uncaughtException]", err.message); });
process.on("unhandledRejection", (r)   => { const m = r?.message || String(r); if (!["EPIPE","ECONNRESET","ETIMEDOUT"].some(s => m.includes(s))) console.error("[unhandledRejection]", m); });

// ─── Globals ─────────────────────────────────────────────────
global.threadState       = { active: new Map(), approved: new Map(), pending: new Map() };
global.client            = { reactionListener: {}, globalData: new Map() };
global.Kagenou           = { autodlEnabled: false, replies: {} };
global.config            = { admins: [], moderators: [], developers: [], vips: [], Prefix: ["."], botName: "Sunken Bot" };
global.globalData        = new Map();
global.usersData         = new Map();
global.userCooldowns     = new Map();
global.commands          = new Map();
global.nonPrefixCommands = new Map();
global.eventCommands     = [];
global.appState          = {};
global.threadConfigs     = new Map();
global.botApi            = null;

const fs    = require("fs-extra");
const path  = require("path");
const login = require("@dongdev/fca-unofficial");
const chalk = require("chalk");

// ─── Logger ──────────────────────────────────────────────────
global.log = {
  info:    msg => console.log(chalk.blue("[INFO]"),    msg),
  warn:    msg => console.log(chalk.yellow("[WARN]"),  msg),
  error:   msg => console.log(chalk.red("[ERROR]"),    msg),
  success: msg => console.log(chalk.green("[SUCCESS]"), msg),
};

// ─── Helpers ─────────────────────────────────────────────────
global.getPrefix = tID => global.threadConfigs.get(tID)?.prefix || global.config.Prefix[0];

// ─── Role Sets ───────────────────────────────────────────────
function buildRoleSets() {
  global._rolesets = {
    dev: new Set((global.config.developers || []).map(String)),
    vip: new Set((global.config.vips       || []).map(String)),
    mod: new Set((global.config.moderators || []).map(String)),
    adm: new Set((global.config.admins     || []).map(String)),
  };
}
buildRoleSets();

global.getUserRole = uid => {
  uid = String(uid);
  const r = global._rolesets;
  if (r.dev.has(uid)) return 4;
  if (r.vip.has(uid)) return 3;
  if (r.mod.has(uid)) return 2;
  if (r.adm.has(uid)) return 1;
  return 0;
};

// ─── Cooldown ────────────────────────────────────────────────
global.setCooldown   = (u, c, t) => global.userCooldowns.set(`${u}:${c}`, Date.now() + t * 1000);
global.checkCooldown = (u, c) => {
  const key = `${u}:${c}`;
  const exp = global.userCooldowns.get(key);
  if (!exp || Date.now() >= exp) { global.userCooldowns.delete(key); return null; }
  return `⏳ انتظر ${Math.ceil((exp - Date.now()) / 1000)} ث`;
};

// ─── تحميل Config ────────────────────────────────────────────
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  global.config = { ...global.config, ...cfg, Prefix: cfg.Prefix || ["."] };
  buildRoleSets();
} catch { console.warn("[WARN] Using default config"); }

// ─── تحميل الأوامر ───────────────────────────────────────────
const loadCommands = () => {
  const dir = path.join(__dirname, "commands");
  if (!fs.existsSync(dir)) return;

  global.commands.clear();
  global.nonPrefixCommands.clear();
  global.eventCommands = [];

  const seen = new Set(); // ← يمنع تسجيل أمر مكرر بسبب aliases
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));

  for (const file of files) {
    try {
      const p   = path.join(dir, file);
      delete require.cache[require.resolve(p)];
      const cmd = require(p);
      const mod = cmd.default || cmd;

      if (!mod.config?.name || !(mod.onStart || mod.run || mod.execute)) continue;

      const name = mod.config.name.toLowerCase();

      // ← تحذير إذا كان الاسم مكرراً بدلاً من الكتابة الصامتة
      if (seen.has(name)) {
        console.warn(chalk.yellow(`[WARN] تعارض في اسم الأمر "${name}" — تم تجاهل "${file}"`));
        continue;
      }
      seen.add(name);

      global.commands.set(name, mod);
      global.nonPrefixCommands.set(name, mod);
      (mod.config.aliases || []).forEach(a => {
        const al = a.toLowerCase();
        if (!global.commands.has(al)) {
          global.commands.set(al, mod);
          global.nonPrefixCommands.set(al, mod);
        }
      });

      if (mod.onChat || mod.handleEvent) global.eventCommands.push(mod);
    } catch (err) { console.warn(`[WARN] فشل تحميل '${file}': ${err.message}`); }
  }

  console.log(chalk.blue(`[INFO] تم تحميل ${seen.size} أمر`));
};
global.reloadCommands = loadCommands;

// ─── AppState ────────────────────────────────────────────────
try {
  const p = path.join(__dirname, "appstate.json");
  if (fs.existsSync(p)) global.appState = JSON.parse(fs.readFileSync(p, "utf8"));
  else if (process.env.APPSTATE || process.env.APPSTATE_BOT1)
    global.appState = JSON.parse(process.env.APPSTATE || process.env.APPSTATE_BOT1);
} catch (_) {}

// ─── Message Context Builder ─────────────────────────────────
function buildMessageCtx(api, event) {
  const { threadID, senderID, messageID } = event;
  return {
    reply: (t, cb) => new Promise(res =>
      api.sendMessage(t, threadID, (err, info) => { if (cb) cb(err, info); res(info || {}); })
    ),
    unsend: (id) => { try { api.unsendMessage(id, () => {}); } catch (_) {} },
    registerReply: (id, d, cb) => {
      global.Kagenou.replies[id] = { callback: cb, author: senderID, timestamp: Date.now(), ...d };
    },
  };
}

// ─── Message Handler ─────────────────────────────────────────
const handleMessage = async (api, event) => {
  const { threadID, senderID, body, messageReply, messageID } = event;
  const hasAttachment = event.attachments?.length > 0;
  if (!body?.trim() && !hasAttachment) return;

  const messageText = body?.trim() || "";

  // ─── Reply Handler ────────────────────────────────────────
  if (messageReply?.messageID && global.Kagenou.replies[messageReply.messageID]) {
    const replyData = global.Kagenou.replies[messageReply.messageID];

    if (!replyData.author || replyData.author === senderID) {
      delete global.Kagenou.replies[messageReply.messageID];

      const cmdForReply = replyData.commandName ? global.commands.get(replyData.commandName) : null;
      const handler = replyData.onReply || replyData.callback ||
        (cmdForReply?.onReply ? (...a) => cmdForReply.onReply(...a) : null);

      if (typeof handler === "function") {
        try {
          await handler({ api, event, message: buildMessageCtx(api, event), Reply: replyData });
        } catch (e) { console.error("[REPLY ERROR]", e.message); }
      }
    }
    return;
  }

  // ─── Command Routing ──────────────────────────────────────
  const parts       = messageText.split(/ +/);
  const commandName = parts[0]?.toLowerCase();
  const args        = parts.slice(1);
  const command     = global.commands.get(commandName);
  if (!command) return;

  const role    = global.getUserRole(senderID);
  const reqRole = command.config?.role ?? 0;
  if (role < reqRole)
    return api.sendMessage("⚠️ هذا الأمر للمشرفين فقط", threadID, null, messageID);

  const cd    = command.config?.countDown ?? 3;
  const cdMsg = global.checkCooldown(senderID, commandName);
  if (cdMsg) return api.sendMessage(cdMsg, threadID, null, messageID);
  global.setCooldown(senderID, commandName, cd);

  try {
    const ctx = {
      api, event, args,
      message:    buildMessageCtx(api, event),
      prefix:     "",
      usersData:  global.usersData,
      globalData: global.globalData,
      db:         global.db,
    };
    if      (command.onStart) await command.onStart(ctx);
    else if (command.run)     await command.run(ctx);
    else if (command.execute) await command.execute(api, event, args, global.commands, "", global.config.admins, global.appState, t => api.sendMessage(t, threadID, null, messageID), global.usersData, global.globalData);
  } catch (err) {
    console.error(`[CMD ERR] ${commandName}:`, err.message);
    api.sendMessage(`❌ خطأ: ${err.message?.substring(0, 100)}`, threadID, null, messageID);
  }
};

// ─── Reaction Handler ────────────────────────────────────────
const handleReaction = async (api, event) => {
  const entry = global.client.reactionListener[event.messageID];
  if (!entry) return;
  if (entry.author && event.userID !== entry.author) return;
  try { await entry.callback({ api, event }); } catch (e) { console.error("[REACTION ERR]", e.message); }
};

// ─── Event Handler ────────────────────────────────────────────
const handleEvent = async (api, event) => {
  const firstWord = event.body?.trim().split(/ +/)[0]?.toLowerCase();

  for (const cmd of global.eventCommands) {
    try {
      if (!cmd.onChat) continue;
      if (!event.messageID || (!event.body && !event.attachments?.length)) continue;
      // تجنب التنفيذ المزدوج: لا نُشغّل onChat إذا كان هذا الأمر هو المطابق للـ command routing
      if (firstWord && global.commands.get(firstWord) === cmd) continue;
      await cmd.onChat({
        api, event,
        message: {
          reply:  (t, cb) => new Promise(res => api.sendMessage(t, event.threadID, (e, i) => { if (cb) cb(e, i); res(i || {}); }, event.messageID)),
          unsend: (id)    => { try { api.unsendMessage(id, () => {}); } catch (_) {} },
        },
      });
    } catch (_) {}
  }
};

// ─── MQTT Listener ────────────────────────────────────────────
const startListening = (api) => {
  let attempts = 0;
  let active   = false;

  const listen = () => {
    if (active) return;
    active = true;

    api.listenMqtt(async (err, event) => {
      if (err) {
        active = false;
        attempts++;
        console.error(chalk.red(`[MQTT] خطأ (${attempts}):`, err.message));
        return setTimeout(listen, Math.min(5000 * attempts, 30000));
      }
      attempts = 0;
      try {
        if (["message", "message_reply", "log", "event"].includes(event.type)) {
          await handleEvent(api, event);
          await handleMessage(api, event);
        } else if (event.type === "message_reaction") {
          await handleReaction(api, event);
        }
      } catch (e) { console.error("[EVENT ERR]", e.message); }
    });
  };

  listen();
  console.log(chalk.green("[SUCCESS] Bot listening..."));
};

// ─── Web Server ───────────────────────────────────────────────
function startWebServer() {
  const PORT    = parseInt(process.env.PORT || "10000");
  const express = require("express");
  const app     = express();

  app.use(express.json());

  // ─── Status Page ──────────────────────────────────────────
  app.get("/", (_req, res) => res.send(
    `<!DOCTYPE html><html lang="ar" dir="rtl">
    <head><meta charset="UTF-8"><title>${global.config.botName}</title></head>
    <body style="font-family:sans-serif;padding:30px;background:#0d1117;color:#c9d1d9">
      <h2>🤖 ${global.config.botName}</h2>
      <p>الحالة: <b style="color:#3fb950">✅ يعمل</b></p>
      <p>⏱️ Uptime: ${Math.floor(process.uptime())} ثانية</p>
      <p>📦 الأوامر: ${global.commands.size}</p>
      <p>🔗 البوت: ${global.botApi ? "متصل" : "جاري الاتصال..."}</p>
    </body></html>`
  ));

  const healthHandler = (_req, res) => res.json({
    status:   "ok",
    bot:      global.botApi ? "connected" : "connecting",
    commands: global.commands.size,
    uptime:   Math.floor(process.uptime()),
    memory:   `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
    time:     new Date().toISOString(),
  });
  app.get("/health",     healthHandler);
  app.get("/api/health", healthHandler);

  // ─── YouTube Routes ───────────────────────────────────────
  try {
    require("./utils/ytRoutes")(app);
  } catch (e) {
    console.warn(chalk.yellow("[WARN] YouTube routes غير متاحة:", e.message));
  }

  app.listen(PORT, () => console.log(chalk.green(`[SUCCESS] 🌐 Web server على المنفذ ${PORT}`)));
  global.expressApp = app;

  // ─── Keep-Alive (Render Free Plan) ───────────────────────
  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  if (externalUrl) {
    const pingUrl = externalUrl.replace(/\/$/, "") + "/health";
    setInterval(() => {
      const mod = pingUrl.startsWith("https") ? require("https") : require("http");
      const req = mod.get(pingUrl, r => { r.resume(); });
      req.on("error", () => {});
      req.setTimeout(20000, () => req.destroy());
    }, 10 * 60 * 1000).unref();
    console.log(chalk.cyan(`[KEEP-ALIVE] ✅ بنغ ذاتي مفعّل → ${pingUrl}`));
  } else {
    console.warn(chalk.yellow("[KEEP-ALIVE] ⚠️ RENDER_EXTERNAL_URL غير مضبوط"));
  }
}

// ─── AppState Save ────────────────────────────────────────────
function saveAppState(state) {
  try {
    fs.writeFileSync(path.join(__dirname, "appstate.json"), JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("[SESSION] ❌ فشل حفظ appstate:", err.message);
  }
}

// ─── 2FA TOTP ────────────────────────────────────────────────
function generate2FACode(secret) {
  if (!secret) return null;
  try {
    const totp = require("totp-generator");
    const fn   = typeof totp === "function" ? totp : totp.generate;
    const code = fn(secret.replace(/\s+/g, "").toUpperCase(), { digits: 6, period: 30 });
    return String(typeof code === "object" ? code.otp || code.token : code);
  } catch { return null; }
}

// ─── Post-Login Setup ─────────────────────────────────────────
function onLoginSuccess(api) {
  api.setOptions({
    forceLogin:     true,
    listenEvents:   true,
    updatePresence: false,
    selfListen:     false,
    online:         true,
    autoMarkRead:   false,
    listenTyping:   false,
    userAgent:      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  });

  global.botApi = api;
  console.log(chalk.green("[LOGIN] ✅ تسجيل الدخول نجح"));

  const freshState = api.getAppState();
  if (freshState?.length) { saveAppState(freshState); global.appState = freshState; }

  // تجديد AppState كل ساعتين
  setInterval(() => {
    try {
      const s = api.getAppState();
      if (s?.length) { saveAppState(s); global.appState = s; }
    } catch (_) {}
  }, 2 * 60 * 60 * 1000).unref();

  startListening(api);

  // تنظيف الذاكرة كل 30 دقيقة
  setInterval(() => {
    const now = Date.now();
    let n = 0;

    for (const [id, d] of Object.entries(global.Kagenou.replies)) {
      if (now - (d.timestamp || 0) > 10 * 60 * 1000) { delete global.Kagenou.replies[id]; n++; }
    }
    for (const [k, exp] of global.userCooldowns) {
      if (now >= exp) { global.userCooldowns.delete(k); n++; }
    }
    for (const [uid, d] of global.usersData) {
      if (d._lastSeen && now - d._lastSeen > 60 * 60 * 1000) { global.usersData.delete(uid); n++; }
    }

    const m = process.memoryUsage();
    console.log(chalk.cyan(
      `[CLEANUP] 🧹 ${n} مدخلة | RSS: ${Math.round(m.rss/1024/1024)}MB` +
      ` | Heap: ${Math.round(m.heapUsed/1024/1024)}/${Math.round(m.heapTotal/1024/1024)}MB`
    ));
  }, 30 * 60 * 1000).unref();
}

// ─── Login with 2FA Support ──────────────────────────────────
function doLogin(credentials, onSuccess) {
  login(credentials, (err, api) => {
    if (!err) return onSuccess(api);
    const errMsg = err?.error || err?.message || String(err);

    if (err.error === "login-approval" || errMsg.includes("login-approval")) {
      const code = generate2FACode(FB_2FA_SECRET);
      if (code && err.continue) {
        err.continue(code, (err2, api2) => {
          if (!err2) return onSuccess(api2);
          console.error(chalk.red("[2FA] ❌ فشل رمز 2FA:", err2?.message || err2));
          process.exit(1);
        });
        return;
      }
    }
    console.error(chalk.red("[LOGIN] ❌ فشل تسجيل الدخول:", errMsg.substring(0, 120)));
    process.exit(1);
  });
}

function fallbackToEmailLogin(reason) {
  console.log(chalk.yellow(`[LOGIN] ⚠️ AppState فشل (${String(reason).substring(0, 60)})`));

  if (!FB_EMAIL || !FB_PASSWORD) {
    console.error(chalk.red("[LOGIN] ❌ FB_EMAIL / FB_PASSWORD غير مضبوطَين في .env"));
    process.exit(1);
  }

  console.log(chalk.blue("[LOGIN] 🔄 تسجيل الدخول بـ Email/Password..."));
  doLogin({ email: FB_EMAIL, password: FB_PASSWORD }, onLoginSuccess);
}

// ─── Startup ─────────────────────────────────────────────────
const { connectDB } = require("./db/index");

async function startBot() {
  startWebServer();      // ← أول شيء: افتح المنفذ (Render ينتظره)
  await connectDB();     // ← MongoDB اختياري
  loadCommands();

  const appStateFile = path.join(__dirname, "appstate.json");
  const hasAppState  = fs.existsSync(appStateFile) || global.appState?.length > 0;

  if (!hasAppState) {
    return fallbackToEmailLogin("لا يوجد appstate.json");
  }

  console.log(chalk.blue("[LOGIN] 🔑 جاري تسجيل الدخول بـ AppState..."));
  login({ appState: global.appState }, (err, api) => {
    if (!err) return onLoginSuccess(api);

    const errMsg = err?.error || err?.message || String(err);
    if (err.error === "login-approval" || errMsg.includes("login-approval")) {
      const code = generate2FACode(FB_2FA_SECRET);
      if (code && err.continue) {
        err.continue(code, (err2, api2) => {
          if (!err2) return onLoginSuccess(api2);
          fallbackToEmailLogin("2FA فشل مع AppState");
        });
        return;
      }
    }
    fallbackToEmailLogin(errMsg);
  });
}

startBot();

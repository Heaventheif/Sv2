/* jshint esversion: 11 */
"use strict";

// ─── منع EPIPE وأخطاء الشبكة من إسقاط البوت ─────────────────
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT") return;
  console.error("[uncaughtException]", err.message);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason?.message || String(reason);
  if (msg.includes("EPIPE") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) return;
  console.error("[unhandledRejection]", msg);
});

// ─── Globals الضرورية فقط ────────────────────────────────────
global.threadState      = { active: new Map(), approved: new Map(), pending: new Map() };
global.client           = { reactionListener: {}, globalData: new Map() };
global.Kagenou          = { autodlEnabled: false, replies: {}, replyListeners: new Map() };
global.config           = { admins: [], moderators: [], developers: [], vips: [], Prefix: ["."], botName: "Sunken Bot" };
global.globalData       = new Map();
global.usersData        = new Map();
global.userCooldowns    = new Map();
global.commands         = new Map();
global.nonPrefixCommands= new Map();
global.eventCommands    = [];
global.appState         = {};
global.threadConfigs    = new Map();
global.botApi           = null;
global.maintenanceMode  = false;
global.disabledGroups   = {};

const fs      = require("fs-extra");
const path    = require("path");
const login   = require("@anbuinfosec/fca-unofficial");
const chalk   = require("chalk");
const express = require("express");

try { require("dotenv").config(); } catch (_) {}

// ─── Logger ──────────────────────────────────────────────────
global.log = {
  info:    msg => console.log(chalk.blue("[INFO]"),    msg),
  warn:    msg => console.log(chalk.yellow("[WARN]"),  msg),
  error:   msg => console.log(chalk.red("[ERROR]"),    msg),
  success: msg => console.log(chalk.green("[SUCCESS]"), msg),
};

// ─── Paths ───────────────────────────────────────────────────
const DASHBOARD_DATA       = path.join(__dirname, "dashboard", "data");
const DISABLED_GROUPS_PATH = path.join(DASHBOARD_DATA, "disabled-groups.json");
const GROUPS_CACHE_PATH    = path.join(DASHBOARD_DATA, "groups-cache.json");
const OUTBOX_PATH          = path.join(DASHBOARD_DATA, "outbox.json");

// ─── JSON helpers ────────────────────────────────────────────
function readJson(fp, fallback = null) {
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { return fallback; }
}
function writeJson(fp, data) {
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) { console.warn("[DB] فشل الكتابة:", e.message); }
}

// ─── Helpers ─────────────────────────────────────────────────
global.getPrefix = tID => global.threadConfigs.get(tID)?.prefix || global.config.Prefix[0];

// ─── Role Sets (تُبنى مرة واحدة، تُحدَّث عند reload) ──────────
function buildRoleSets() {
  global._rolesets = {
    dev:  new Set((global.config.developers || []).map(String)),
    vip:  new Set((global.config.vips       || []).map(String)),
    mod:  new Set((global.config.moderators || []).map(String)),
    adm:  new Set((global.config.admins     || []).map(String)),
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

// ─── Cooldown (يحذف المنتهي فوراً) ────────────────────────────
global.setCooldown   = (u, c, t) => global.userCooldowns.set(`${u}:${c}`, Date.now() + t * 1000);
global.checkCooldown = (u, c) => {
  const key = `${u}:${c}`;
  const exp = global.userCooldowns.get(key);
  if (!exp || Date.now() >= exp) {
    global.userCooldowns.delete(key); // ← حذف فوري عند الانتهاء
    return null;
  }
  return `⏳ انتظر ${Math.ceil((exp - Date.now()) / 1000)} ث`;
};

// ─── تحميل Config ────────────────────────────────────────────
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  global.config = { ...global.config, ...cfg, Prefix: cfg.Prefix || ["."] };
  buildRoleSets(); // أعد بناء الـ Sets بعد تحميل config
} catch { console.warn("[WARN] Using default config"); }

// ─── تحميل الأوامر ───────────────────────────────────────────
const loadCommands = () => {
  const dir = path.join(__dirname, "commands");
  if (!fs.existsSync(dir)) return;
  global.commands.clear();
  global.nonPrefixCommands.clear();
  global.eventCommands = [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
  for (const file of files) {
    try {
      const p   = path.join(dir, file);
      delete require.cache[require.resolve(p)];
      const cmd = require(p);
      const mod = cmd.default || cmd;
      if (mod.config?.name && (mod.onStart || mod.run || mod.execute)) {
        const name = mod.config.name.toLowerCase();
        global.commands.set(name, mod);
        global.nonPrefixCommands.set(name, mod);
        (mod.config.aliases || []).forEach(a => {
          global.commands.set(a.toLowerCase(), mod);
          global.nonPrefixCommands.set(a.toLowerCase(), mod);
        });
      }
      if (mod.onChat || mod.handleEvent) global.eventCommands.push(mod);
    } catch (err) { console.warn(`[WARN] فشل تحميل '${file}': ${err.message}`); }
  }
  console.log(chalk.blue(`[INFO] تم تحميل ${global.commands.size} أمر`));
};
global.reloadCommands = loadCommands;

// ─── AppState ────────────────────────────────────────────────
let dashboardOnly = false;
try {
  const p = path.join(__dirname, "appstate.json");
  if (fs.existsSync(p)) {
    global.appState = JSON.parse(fs.readFileSync(p, "utf8"));
  } else if (process.env.APPSTATE || process.env.APPSTATE_BOT1) {
    global.appState = JSON.parse(process.env.APPSTATE || process.env.APPSTATE_BOT1);
  } else {
    dashboardOnly = true;
  }
} catch { dashboardOnly = true; }

// ─── Group Disabled Check (كاش في الذاكرة — بدل قراءة disk كل رسالة) ────
let _disabledCache = {};
let _disabledCacheLoaded = false;
function refreshDisabledCache() {
  _disabledCache = readJson(DISABLED_GROUPS_PATH, {});
  _disabledCacheLoaded = true;
}
refreshDisabledCache(); // تحميل أولي
setInterval(refreshDisabledCache, 30_000); // تحديث كل 30 ثانية

function isGroupDisabled(threadID) {
  if (!_disabledCacheLoaded) refreshDisabledCache();
  return !!_disabledCache[threadID];
}

// تحديث الكاش فوراً عند تغيير حالة مجموعة (يستدعيها الداشبورد)
global.refreshDisabledCache = refreshDisabledCache;

// ─── Outbox (Dashboard → Messenger) ─────────────────────────
let outboxBusy = false;
function processOutbox() {
  if (outboxBusy || !global.botApi) return;
  const outbox  = readJson(OUTBOX_PATH, []);
  const pending = outbox.filter(e => e.status === "pending");
  if (!pending.length) return;
  outboxBusy = true;
  (async () => {
    const updated = outbox.map(e => ({ ...e }));
    for (const entry of updated) {
      if (entry.status !== "pending") continue;
      entry.status = "sending";
      for (const tid of (entry.threadIDs || [])) {
        try {
          await new Promise((res, rej) =>
            global.botApi.sendMessage(entry.message, tid, err => err ? rej(err) : res())
          );
          await new Promise(r => setTimeout(r, 600));
        } catch (e) { console.warn("[Outbox] فشل:", tid, e.message); }
      }
      entry.status = "sent";
      entry.sentAt = new Date().toISOString();
    }
    writeJson(OUTBOX_PATH, updated.filter(e => e.status !== "sent"));
    outboxBusy = false;
  })().catch(() => { outboxBusy = false; });
}

// ─── Groups Cache ────────────────────────────────────────────
function cacheGroups() {
  if (!global.botApi) return;
  global.botApi.getThreadList(30, null, ["INBOX"], (err, threads) => {
    if (err || !threads) return;
    const cache = readJson(GROUPS_CACHE_PATH, {});
    for (const t of threads) {
      if (!t.isGroup) continue;
      cache[t.threadID] = {
        name: t.name || `مجموعة ${t.threadID.slice(-6)}`,
        participantCount: t.participantIDs?.length || 0,
        lastSeen: new Date().toISOString(),
      };
    }
    writeJson(GROUPS_CACHE_PATH, cache);
  });
}

// ─── Message Handler ─────────────────────────────────────────
const handleMessage = async (api, event) => {
  const { threadID, senderID, body, messageReply, messageID } = event;
  const hasAttachment = (event.attachments?.length > 0);
  if (!body?.trim() && !hasAttachment) return;
  if (isGroupDisabled(threadID)) return;

  const messageText = body.trim();

  // ─── Reply handler ────────────────────────────────────────
  if (messageReply && global.Kagenou.replies?.[messageReply.messageID]) {
    const replyData = global.Kagenou.replies[messageReply.messageID];
    // لا نحذف الرد حتى نتأكد من التنفيذ
    if (!replyData.author || replyData.author === senderID) {
      delete global.Kagenou.replies[messageReply.messageID];
      // يدعم كلاً من: onReply (yt.js) و callback (أوامر أخرى)
      // إذا لم يكن هناك handler محفوظ، ابحث عن onReply في الأمر نفسه
      const cmdForReply = replyData.commandName
        ? global.commands.get(replyData.commandName)
        : null;
      const handler = replyData.onReply || replyData.callback ||
        (cmdForReply?.onReply ? (...a) => cmdForReply.onReply(...a) : null);
      if (typeof handler === "function") {
        const replyMessage = {
          reply: (t, cb) => {
            return new Promise((resolve) => {
              api.sendMessage(t, threadID, (err, info) => {
                if (cb) cb(err, info);
                resolve(info);
              }, messageID);
            });
          },
          unsend: (msgID) => {
            try { api.unsendMessage(msgID, () => {}); } catch (_) {}
          },
          registerReply: (id, d, cb) => {
            global.Kagenou.replies[id] = { callback: cb, author: senderID, timestamp: Date.now(), ...d };
          }
        };
        try {
          await handler({ api, event, message: replyMessage, Reply: replyData });
        } catch (e) { console.error("[REPLY ERROR]", e.message); }
      }
    }
    return;
  }

  // ─── Command routing ──────────────────────────────────────
  const parts       = messageText.split(/ +/);
  const commandName = parts[0]?.toLowerCase();
  const args        = parts.slice(1);
  const command     = global.commands.get(commandName);
  if (!command) return;

  // ─── Role check ───────────────────────────────────────────
  const role    = global.getUserRole(senderID);
  const reqRole = command.config?.role ?? 0;
  if (role < reqRole) {
    return api.sendMessage("⚠️ هذا الأمر للمشرفين فقط", threadID, null, messageID);
  }

  // ─── Cooldown ─────────────────────────────────────────────
  const cd    = command.config?.countDown ?? 3;
  const cdMsg = global.checkCooldown(senderID, commandName);
  if (cdMsg) return api.sendMessage(cdMsg, threadID, null, messageID);
  global.setCooldown(senderID, commandName, cd);

  // ─── Execute ──────────────────────────────────────────────
  try {
    const ctx = {
      api, event, args,
      message: {
        // يدعم: string | { body, attachment } | callback(err, info)
        reply: (t, cb) => {
          return new Promise((resolve) => {
            api.sendMessage(t, threadID, (err, info) => {
              if (cb) cb(err, info);
              resolve(info);
            }, messageID);
          });
        },
        unsend: (msgID) => {
          try { api.unsendMessage(msgID, () => {}); } catch (_) {}
        },
        registerReply: (id, d, cb) => {
          global.Kagenou.replies[id] = { callback: cb, author: senderID, timestamp: Date.now(), ...d };
        }
      },
      prefix: "", usersData: global.usersData,
      globalData: global.globalData, db: global.db,
    };
    if      (command.onStart) await command.onStart(ctx);
    else if (command.run)     await command.run(ctx);
    else if (command.execute) await command.execute(api, event, args, global.commands, "", global.config.admins, global.appState, t => api.sendMessage(t, threadID, null, messageID), global.usersData, global.globalData);
  } catch (err) {
    console.error(`[CMD ERR] ${commandName}:`, err.message);
    api.sendMessage(`❌ خطأ: ${err.message?.substring(0, 100)}`, threadID, null, messageID);
  }
};

// ─── Event Handler ────────────────────────────────────────────
const handleEvent = async (api, event) => {
  // ━━━ إصلاح السبب الأول للتنفيذ المزدوج ━━━━━━━━━━━━━━━━━━━━
  // إذا كانت الرسالة تبدأ بكلمة تُطابق أمراً معروفاً في global.commands،
  // فسيُعالجه handleMessage عبر onStart — نتجنب استدعاء onChat لنفس الأمر
  const firstWord = event.body?.trim().split(/ +/)[0]?.toLowerCase();

  for (const cmd of global.eventCommands) {
    try {
      if (cmd.onChat) {
        const hasAtt = (event.attachments?.length > 0);
        if (!event.messageID || (!event.body && !hasAtt)) continue;

        // ← الإصلاح: تجاهل onChat إذا كان هذا الأمر بعينه هو المطابق للكلمة الأولى
        // هذا يمنع تنفيذ الأمر مرة بـ onChat ومرة أخرى بـ onStart
        if (firstWord && global.commands.get(firstWord) === cmd) continue;

        await cmd.onChat({
          api, event,
          message: { reply: t => api.sendMessage(t, event.threadID, null, event.messageID) }
        });
      }
    } catch (_) {}
  }
};

// ─── MQTT Listener ────────────────────────────────────────────
const startListening = (api) => {
  let attempts       = 0;
  let listenerActive = false; // ← إصلاح السبب الثاني: يمنع تراكم المستمعين

  const listen = () => {
    // ← إذا كان هناك مستمع نشط بالفعل، لا ننشئ آخر
    if (listenerActive) return;
    listenerActive = true;

    api.listenMqtt(async (err, event) => {
      if (err) {
        listenerActive = false; // ← نُعلن أن المستمع انتهى قبل إنشاء واحد جديد
        attempts++;
        console.error(chalk.red(`[MQTT] خطأ (${attempts}):`, err.message));
        return setTimeout(listen, Math.min(5000 * attempts, 30000));
      }
      attempts = 0;
      try {
        if (["message","message_reply","log","event"].includes(event.type)) {
          await handleEvent(api, event);
          await handleMessage(api, event);
        }
      } catch (e) { console.error("[EVENT ERR]", e.message); }
    });
  };
  listen();
  console.log(chalk.green("[SUCCESS] Bot listening..."));
};

// ─── Web Server (Render keep-alive) ──────────────────────────
// يجب أن يبدأ أولاً — Render ينتظر منفذاً مفتوحاً خلال 3-4 دقائق
function startWebServer() {
  const PORT = parseInt(process.env.PORT || "10000");
  const app  = express();

  // الصفحة الرئيسية — تُظهر حالة البوت
  app.get("/", (_req, res) => {
    res.send(`
      <!DOCTYPE html><html lang="ar" dir="rtl">
      <head><meta charset="UTF-8"><title>${global.config.botName}</title></head>
      <body style="font-family:sans-serif;padding:30px;background:#0d1117;color:#c9d1d9">
        <h2>🤖 ${global.config.botName}</h2>
        <p>الحالة: <b style="color:#3fb950">✅ يعمل</b></p>
        <p>⏱️ Uptime: ${Math.floor(process.uptime())} ثانية</p>
        <p>📦 الأوامر: ${global.commands.size}</p>
        <p>🔗 البوت: ${global.botApi ? "متصل" : "جاري الاتصال..."}</p>
      </body></html>
    `);
  });

  // health check — هذا ما يستخدمه Render (healthCheckPath: /api/health)
  app.get("/health",     healthHandler);
  app.get("/api/health", healthHandler);

  function healthHandler(_req, res) {
    res.json({
      status:    "ok",
      bot:       global.botApi ? "connected" : "connecting",
      commands:  global.commands.size,
      uptime:    Math.floor(process.uptime()),
      memory:    `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
      timestamp: new Date().toISOString(),
    });
  }

  app.listen(PORT, () => {
    console.log(chalk.green(`[SUCCESS] 🌐 Web server على المنفذ ${PORT}`));
  });

  global.expressApp = app;

  // ─── Keep-Alive: ping نفسه كل 14 دقيقة لمنع النوم على render المجاني ──
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || "https://sv2-nzbg.onrender.com";
  setInterval(async () => {
    try {
      const http  = SELF_URL.startsWith("https") ? require("https") : require("http");
      await new Promise((resolve, reject) => {
        const req = http.get(`${SELF_URL}/health`, (res) => {
          console.log(chalk.cyan(`[PING] ✅ keep-alive → ${res.statusCode}`));
          resolve();
        });
        req.on("error", reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error("timeout")); });
      });
    } catch (e) {
      console.warn(chalk.yellow(`[PING] ⚠️ فشل keep-alive: ${e.message}`));
    }
  }, 14 * 60 * 1000); // كل 14 دقيقة
}

// ─── DB ──────────────────────────────────────────────────────
async function connectDB() {
  const uri = process.env.MONGO_URI || global.config.mongoUri;
  if (!uri) { global.db = null; return; }
  try {
    const { MongoClient } = require("mongodb");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    global.db = { db: col => client.db("chatbot_db").collection(col) };
    console.log(chalk.green("[SUCCESS] MongoDB connected"));
  } catch { console.warn("[WARN] MongoDB فشل — وضع JSON"); global.db = null; }
}

// ─── Startup ─────────────────────────────────────────────────
const startBot = async () => {
  // ① أول شيء: افتح المنفذ — Render يرفض العملية إذا لم يجد port خلال دقائق
  startWebServer();

  await connectDB();
  loadCommands();

  if (dashboardOnly) {
    console.log("[BOT] وضع الداشبورد فقط");
    return;
  }

  login({ appState: global.appState }, (err, api) => {
    if (err) { console.error("[FATAL] Login failed:", err); process.exit(1); }

    api.setOptions({
      forceLogin:      true,
      listenEvents:    true,
      updatePresence:  false,
      selfListen:      false,
      online:          true,
      autoMarkDelivery: false,
      autoMarkRead:    false,
      listenTyping:    false,
    });

    global.botApi = api;
    startListening(api);

    // ─── تنظيف الذاكرة كل 30 دقيقة ──────────────────────────
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      // 1) حذف Kagenou.replies القديمة (+10 دقائق)
      for (const [id, data] of Object.entries(global.Kagenou.replies)) {
        if (now - (data.timestamp || 0) > 10 * 60 * 1000) {
          delete global.Kagenou.replies[id];
          cleaned++;
        }
      }

      // 2) حذف userCooldowns المنتهية
      for (const [key, exp] of global.userCooldowns.entries()) {
        if (now >= exp) { global.userCooldowns.delete(key); cleaned++; }
      }

      // 3) حذف usersData للمستخدمين غير النشطين (+1 ساعة)
      for (const [uid, data] of global.usersData.entries()) {
        if (data._lastSeen && now - data._lastSeen > 60 * 60 * 1000) {
          global.usersData.delete(uid); cleaned++;
        }
      }

      const mem = process.memoryUsage();
      console.log(chalk.cyan(
        `[CLEANUP] 🧹 حُذف ${cleaned} مدخلة | RSS: ${Math.round(mem.rss/1024/1024)}MB` +
        ` | Heap: ${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB`
      ));
    }, 30 * 60 * 1000);

    // ─── حماية الجلسة ────────────────────────────────────
    try {
      const sessionGuard = require("./session-guard");
      sessionGuard.init(api, {
        onSuspended: (msg) => {
          console.error("[SESSION] 🔴 الجلسة معلقة:", msg);
          const adminId = global.config.admins?.[0];
          if (adminId) {
            try { global.botApi?.sendMessage(
              "⚠️ الجلسة انتهت — جارٍ إعادة تسجيل الدخول تلقائياً...",
              adminId
            ); } catch (_) {}
          }
        },
        onRestored: (newApi) => {
          console.log(chalk.green("[SESSION] ✅ الجلسة استُعيدت — إعادة تشغيل المستمع"));
          // أعد تشغيل المستمع بالـ api الجديد
          startListening(newApi);
          const adminId = global.config.admins?.[0];
          if (adminId) {
            try { newApi.sendMessage("✅ تم تجديد الجلسة تلقائياً بنجاح!", adminId); } catch (_) {}
          }
        },
        onFailed: () => {
          console.error(chalk.red("[SESSION] ❌ فشل تجديد الجلسة — يرجى تحديث appstate يدوياً"));
          const adminId = global.config.admins?.[0];
          if (adminId) {
            try { global.botApi?.sendMessage(
              "❌ فشل تجديد الجلسة تلقائياً.\nيرجى تحديث APPSTATE يدوياً.",
              adminId
            ); } catch (_) {}
          }
        }
      });
      console.log(chalk.green("[SESSION] 🛡️ session-guard مُفعَّل"));
    } catch (e) {
      console.warn("[SESSION] ⚠️ session-guard غير متاح:", e.message);
    }

    // SoundCloud webhook (اختياري — يُتجاهل إن لم يكن الملف موجوداً)
    try {
      const scCmd = require("./commands/SoundCloud");
      if (scCmd && scCmd.setupWebhook && global.expressApp) scCmd.setupWebhook(global.expressApp, api);
    } catch (_) {}

    // Cache groups عند البدء فقط
    setTimeout(cacheGroups, 5000);

    // Outbox كل 30 ثانية (بدل 10)
    setInterval(processOutbox, 30_000);
  });
};

startBot();

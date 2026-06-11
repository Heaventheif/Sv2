"use strict";

/**
 * index.js — السكريبت الرئيسي للبوت
 *
 * الترتيب:
 *  1. معالجة الأخطاء العامة
 *  2. تعريف المتغيرات العالمية
 *  3. الاتصال بـ MongoDB (Mongoose)
 *  4. خادم Express (Keep-Alive لـ Render)
 *  5. تحميل الأوامر
 *  6. تسجيل الدخول وبدء الاستماع
 */

// ─── 0. معالجة الأخطاء العامة ────────────────────────────────
process.on("unhandledRejection", (reason) => {
  const msg = String(reason?.message || reason || "");
  // أخطاء داخلية من fca-unofficial — آمنة للتجاهل
  if (
    msg.includes("Missing required parameters") ||
    msg.includes("setMessageReaction") ||
    msg.includes("mqtt") ||
    msg.includes("MQTT")
  ) return;
  console.error("[UnhandledRejection]", msg.substring(0, 200));
});

process.on("uncaughtException", (err) => {
  const msg = String(err?.message || err || "");
  if (
    msg.includes("Missing required parameters") ||
    msg.includes("setMessageReaction")
  ) return;
  console.error("[UncaughtException]", msg.substring(0, 200));
});

// ─── 1. التبعيات الأساسية ─────────────────────────────────────
const fs    = require("fs-extra");
const path  = require("path");
const chalk = require("chalk");

try { require("dotenv").config(); } catch (_) {}

// ─── 2. المتغيرات العالمية ────────────────────────────────────
global.threadState       = { active: new Map(), approved: new Map(), pending: new Map() };
global.client            = { reactionListener: {}, globalData: new Map() };
global.Kagenou           = { autodlEnabled: false, replies: {}, replyListeners: new Map() };
global.config            = {
  admins: [], moderators: [], developers: [], vips: [],
  Prefix: ["."], botName: "Sunken Bot", mongoUri: null,
};
global.globalData        = new Map();
global.usersData         = new Map();
global.userCooldowns     = new Map();
global.commands          = new Map();
global.nonPrefixCommands = new Map();
global.eventCommands     = [];
global.appState          = {};
global.threadConfigs     = new Map();
global.botApi            = null;
global.db                = null; // سيُعيَّن بعد الاتصال بـ MongoDB
global.maintenanceMode   = false;

// ─── Logger ──────────────────────────────────────────────────
global.log = {
  info:    (msg) => console.log(chalk.blue("[INFO]"),     msg),
  warn:    (msg) => console.log(chalk.yellow("[WARN]"),   msg),
  error:   (msg) => console.log(chalk.red("[ERROR]"),     msg),
  success: (msg) => console.log(chalk.green("[SUCCESS]"), msg),
};

// ─── Paths ───────────────────────────────────────────────────
const DASHBOARD_DATA       = path.join(__dirname, "dashboard", "data");
const DISABLED_GROUPS_PATH = path.join(DASHBOARD_DATA, "disabled-groups.json");
const GROUPS_CACHE_PATH    = path.join(DASHBOARD_DATA, "groups-cache.json");
const OUTBOX_PATH          = path.join(DASHBOARD_DATA, "outbox.json");

// ─── JSON helpers ────────────────────────────────────────────
function readJson(fp, fallback = null) {
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); }
  catch { return fallback; }
}
function writeJson(fp, data) {
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) { console.warn("[DB] فشل الكتابة:", e.message); }
}

// ─── تحميل config.json ───────────────────────────────────────
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  global.config = { ...global.config, ...cfg, Prefix: cfg.Prefix || ["."] };
} catch { console.warn("[WARN] Using default config"); }

// ─── Role sets (Map سريعة بدل indexOf) ───────────────────────
function buildRoleSets() {
  global._roles = {
    dev: new Set((global.config.developers || []).map(String)),
    vip: new Set((global.config.vips       || []).map(String)),
    mod: new Set((global.config.moderators || []).map(String)),
    adm: new Set((global.config.admins     || []).map(String)),
  };
}
buildRoleSets();

global.getPrefix   = (tID) => global.threadConfigs.get(tID)?.prefix || global.config.Prefix[0];
global.getUserRole = (uid) => {
  uid = String(uid);
  const r = global._roles;
  if (r.dev.has(uid)) return 4;
  if (r.vip.has(uid)) return 3;
  if (r.mod.has(uid)) return 2;
  if (r.adm.has(uid)) return 1;
  return 0;
};

global.setCooldown   = (u, c, t) => global.userCooldowns.set(`${u}:${c}`, Date.now() + t * 1000);
global.checkCooldown = (u, c) => {
  const key = `${u}:${c}`;
  const exp = global.userCooldowns.get(key);
  if (!exp || Date.now() >= exp) { global.userCooldowns.delete(key); return null; }
  return `⏳ انتظر ${Math.ceil((exp - Date.now()) / 1000)} ث`;
};
global.reloadCommands = () => loadCommands();

// ─── تحميل AppState ──────────────────────────────────────────
let dashboardOnly = false;
try {
  const p = path.join(__dirname, "appstate.json");
  if (fs.existsSync(p)) {
    global.appState = JSON.parse(fs.readFileSync(p, "utf8"));
  } else if (process.env.APPSTATE || process.env.APPSTATE_BOT1) {
    global.appState = JSON.parse(process.env.APPSTATE || process.env.APPSTATE_BOT1);
  } else {
    dashboardOnly = true;
    console.warn(chalk.yellow("[WARN] لم يُعثر على appstate — وضع الداشبورد فقط"));
  }
} catch {
  dashboardOnly = true;
  console.warn(chalk.yellow("[WARN] فشل تحليل AppState — وضع الداشبورد فقط"));
}

// ══════════════════════════════════════════════════════════════
//  3. الاتصال بـ MongoDB (Mongoose)
//     منطق الاتصال موحَّد في db/index.js
// ══════════════════════════════════════════════════════════════
const { connectDB } = require("./db");

// ══════════════════════════════════════════════════════════════
//  4. خادم Express — Keep-Alive لـ Render
//     يمنع Render من إدخال البوت في وضع النوم (Spin-down)
// ══════════════════════════════════════════════════════════════
function startWebServer() {
  const express = require("express");
  const app     = express();

  // ─── الصفحة الرئيسية ───────────────────────────────────────
  app.get("/", (_req, res) => {
    const mem  = process.memoryUsage();
    const up   = process.uptime();
    const h    = Math.floor(up / 3600);
    const m    = Math.floor((up % 3600) / 60);
    const s    = Math.floor(up % 60);

    res.json({
      status:    "✅ البوت يعمل",
      botName:   global.config.botName || "Sunken Bot",
      uptime:    `${h}س ${m}د ${s}ث`,
      memory:    `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      db:        global.db ? "متصل ✅" : "غير متصل ⚠️",
      commands:  global.commands.size,
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Healthcheck لـ Render ─────────────────────────────────
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // ─── تشغيل الداشبورد إن وُجد ──────────────────────────────
  try {
    const dashboardRouter = require("./dashboard/server.js");
    if (typeof dashboardRouter === "function") {
      app.use(dashboardRouter);
      console.log(chalk.blue("[WEB] 🌐 الداشبورد مُدمَج"));
    }
  } catch (_) {
    // الداشبورد اختياري — يُتجاهل إن لم يكن موجوداً
  }

  // ─── Fallback 404 ──────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: "404 — المسار غير موجود" });
  });

  // ─── بدء الاستماع على PORT ─────────────────────────────────
  const PORT = parseInt(process.env.PORT || "3000", 10);
  app.listen(PORT, () => {
    console.log(chalk.green(`[WEB] ✅ الخادم يعمل على البورت ${PORT}`));
  });

  global.expressApp = app;
}

// ══════════════════════════════════════════════════════════════
//  5. تحميل الأوامر
// ══════════════════════════════════════════════════════════════
function loadCommands() {
  const dir = path.join(__dirname, "commands");
  if (!fs.existsSync(dir)) { console.error("[ERROR] مجلد commands غير موجود"); return; }

  global.commands.clear();
  global.nonPrefixCommands.clear();
  global.eventCommands = [];

  const files = fs.readdirSync(dir).filter(
    (f) => f.endsWith(".js") && !fs.statSync(path.join(dir, f)).isDirectory()
  );

  for (const file of files) {
    try {
      const p   = path.join(dir, file);
      delete require.cache[require.resolve(p)];
      const raw = require(p);
      const mod = raw.default || raw;

      if (mod.config?.name && (mod.onStart || mod.run || mod.execute)) {
        const name = mod.config.name.toLowerCase();
        global.commands.set(name, mod);
        global.nonPrefixCommands.set(name, mod);
        (mod.config.aliases || []).forEach((a) => {
          global.commands.set(a.toLowerCase(), mod);
          global.nonPrefixCommands.set(a.toLowerCase(), mod);
        });
      }
      if (mod.onChat || mod.handleEvent) global.eventCommands.push(mod);
    } catch (err) {
      console.warn(chalk.yellow(`[WARN] فشل تحميل '${file}':`), err.message);
    }
  }
  console.log(chalk.blue(`[INFO] ✅ تم تحميل ${global.commands.size} أمر`));
}

// ══════════════════════════════════════════════════════════════
//  Disabled Groups Cache (كاش في الذاكرة — قراءة ملف كل 30 ث)
// ══════════════════════════════════════════════════════════════
let _disabledCache = {};
function refreshDisabledCache() { _disabledCache = readJson(DISABLED_GROUPS_PATH, {}); }
refreshDisabledCache();
setInterval(refreshDisabledCache, 30_000);
global.refreshDisabledCache = refreshDisabledCache;

function isGroupDisabled(threadID) { return !!_disabledCache[threadID]; }

// ══════════════════════════════════════════════════════════════
//  Outbox (رسائل الداشبورد → Messenger)
// ══════════════════════════════════════════════════════════════
let outboxBusy = false;
function processOutbox() {
  if (outboxBusy || !global.botApi) return;
  const outbox  = readJson(OUTBOX_PATH, []);
  const pending = outbox.filter((e) => e.status === "pending");
  if (!pending.length) return;

  outboxBusy = true;
  (async () => {
    const updated = outbox.map((e) => ({ ...e }));
    for (const entry of updated) {
      if (entry.status !== "pending") continue;
      entry.status = "sending";
      for (const tid of entry.threadIDs || []) {
        try {
          await new Promise((res, rej) =>
            global.botApi.sendMessage(entry.message, tid, (err) => (err ? rej(err) : res()))
          );
          await new Promise((r) => setTimeout(r, 600));
        } catch (e) { console.warn("[Outbox]", tid, e.message); }
      }
      entry.status = "sent";
      entry.sentAt = new Date().toISOString();
    }
    writeJson(OUTBOX_PATH, updated.filter((e) => e.status !== "sent"));
    outboxBusy = false;
  })().catch(() => { outboxBusy = false; });
}

// ══════════════════════════════════════════════════════════════
//  Groups Cache
// ══════════════════════════════════════════════════════════════
function cacheGroups() {
  if (!global.botApi) return;
  global.botApi.getThreadList(30, null, ["INBOX"], (err, threads) => {
    if (err || !threads) return;
    const cache = readJson(GROUPS_CACHE_PATH, {});
    for (const t of threads) {
      if (!t.isGroup) continue;
      cache[t.threadID] = {
        name:             t.name || `مجموعة ${t.threadID.slice(-6)}`,
        participantCount: t.participantIDs?.length || 0,
        lastSeen:         new Date().toISOString(),
      };
    }
    writeJson(GROUPS_CACHE_PATH, cache);
  });
}

// ══════════════════════════════════════════════════════════════
//  Message Handler
// ══════════════════════════════════════════════════════════════
const handleMessage = async (api, event) => {
  const { threadID, senderID, body, messageReply, messageID } = event;
  if (!body?.trim() || !messageID || !threadID || !senderID) return;
  if (isGroupDisabled(threadID)) return;

  const messageText = body.trim();

  // ─── Reply handler ────────────────────────────────────────
  if (messageReply && global.Kagenou.replies?.[messageReply.messageID]) {
    const replyData = global.Kagenou.replies[messageReply.messageID];
    delete global.Kagenou.replies[messageReply.messageID];
    if (!replyData.author || replyData.author === senderID) {
      try {
        await replyData.callback({
          api, event,
          message: {
            reply:         (txt) => api.sendMessage(txt, threadID, null, messageID),
            registerReply: (id, d, cb) => {
              global.Kagenou.replies[id] = { callback: cb, author: senderID, timestamp: Date.now(), ...d };
            },
          },
          Reply: replyData,
        });
      } catch (e) { console.error("[REPLY]", e.message); }
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
  if (role < reqRole)
    return api.sendMessage("⚠️ هذا الأمر للمشرفين فقط", threadID, null, messageID);

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
        reply:         (t) => api.sendMessage(t, threadID, null, messageID),
        registerReply: (id, d, cb) => {
          global.Kagenou.replies[id] = { callback: cb, author: senderID, timestamp: Date.now(), ...d };
        },
      },
      prefix:     "",
      usersData:  global.usersData,
      globalData: global.globalData,
      db:         global.db,
    };
    if      (command.onStart) await command.onStart(ctx);
    else if (command.run)     await command.run(ctx);
    else if (command.execute) await command.execute(
      api, event, args, global.commands, "", global.config.admins,
      global.appState, (t) => api.sendMessage(t, threadID, null, messageID),
      global.usersData, global.globalData
    );
  } catch (err) {
    console.error(chalk.red(`[CMD ERR] ${commandName}:`), err.message);
    api.sendMessage(`❌ خطأ: ${err.message?.substring(0, 100)}`, threadID, null, messageID);
  }
};

// ══════════════════════════════════════════════════════════════
//  Event Handler
// ══════════════════════════════════════════════════════════════
const handleEvent = async (api, event) => {
  for (const cmd of global.eventCommands) {
    try {
      if (cmd.onChat && event.messageID && event.body) {
        await cmd.onChat({
          api, event,
          message: { reply: (t) => api.sendMessage(t, event.threadID, null, event.messageID) },
        });
      }
    } catch (_) {}
  }
};

// ══════════════════════════════════════════════════════════════
//  MQTT Listener
// ══════════════════════════════════════════════════════════════
function startListening(api) {
  let attempts = 0;
  const listen = () => {
    api.listenMqtt(async (err, event) => {
      if (err) {
        attempts++;
        console.error(chalk.red(`[MQTT] خطأ (${attempts}):`), err.message);
        return setTimeout(listen, Math.min(5000 * attempts, 30_000));
      }
      attempts = 0;
      try {
        if (["message", "message_reply", "log", "event"].includes(event.type)) {
          await handleEvent(api, event);
          await handleMessage(api, event);
        }
      } catch (e) { console.error("[EVENT ERR]", e.message); }
    });
  };
  listen();
  console.log(chalk.green("[SUCCESS] ✅ البوت يستمع للرسائل..."));
}

// ══════════════════════════════════════════════════════════════
//  تنظيف الذاكرة (كل 30 دقيقة)
// ══════════════════════════════════════════════════════════════
function startMemoryCleanup() {
  setInterval(() => {
    const now     = Date.now();
    let   cleaned = 0;

    for (const [id, data] of Object.entries(global.Kagenou.replies)) {
      if (now - (data.timestamp || 0) > 10 * 60_000) {
        delete global.Kagenou.replies[id];
        cleaned++;
      }
    }
    for (const [k, exp] of global.userCooldowns) {
      if (now >= exp) { global.userCooldowns.delete(k); cleaned++; }
    }
    for (const [uid, data] of global.usersData) {
      if (data._lastSeen && now - data._lastSeen > 60 * 60_000) {
        global.usersData.delete(uid); cleaned++;
      }
    }

    const mem = process.memoryUsage();
    console.log(
      chalk.cyan(
        `[CLEANUP] 🧹 ${cleaned} مدخلة | RSS: ${Math.round(mem.rss / 1024 / 1024)}MB` +
        ` | Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB`
      )
    );
  }, 30 * 60_000);
}

// ══════════════════════════════════════════════════════════════
//  6. نقطة الدخول الرئيسية
//  الترتيب مهم جداً:
//   MongoDB أولاً ← خادم الويب ← تحميل الأوامر ← تسجيل الدخول
// ══════════════════════════════════════════════════════════════
async function main() {
  console.log(chalk.bold.green("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold.green("   🌿 Sunken Bot — بدء التشغيل"));
  console.log(chalk.bold.green("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  // ── الخطوة 1: الاتصال بـ MongoDB ──────────────────────────
  await connectDB();

  // ── الخطوة 2: خادم Express (Keep-Alive) ───────────────────
  startWebServer();

  // ── الخطوة 3: تحميل الأوامر ───────────────────────────────
  loadCommands();

  // ── الخطوة 4: تسجيل الدخول ────────────────────────────────
  if (dashboardOnly) {
    console.log(chalk.yellow("[BOT] ⚠️ وضع الداشبورد فقط — لا يوجد appstate"));
    return;
  }

  const login = require("@anbuinfosec/fca-unofficial");
  login({ appState: global.appState }, (err, api) => {
    if (err) {
      console.error(chalk.red("[FATAL] فشل تسجيل الدخول:"), err.message || err);
      process.exit(1);
    }

    api.setOptions({
      forceLogin:     true,
      listenEvents:   true,
      updatePresence: false,
      selfListen:     false,
      online:         true,
      autoMarkRead:   false,
      listenTyping:   false,
    });

    global.botApi = api;
    console.log(chalk.green("[BOT] ✅ تم تسجيل الدخول بنجاح"));

    // بدء الاستماع
    startListening(api);

    // جلب المجموعات لأول مرة بعد 5 ثواني
    setTimeout(cacheGroups, 5_000);

    // معالجة رسائل الداشبورد كل 30 ثانية
    setInterval(processOutbox, 30_000);

    // تنظيف الذاكرة كل 30 دقيقة
    startMemoryCleanup();
  });
}

// ─── تشغيل ────────────────────────────────────────────────────
main().catch((err) => {
  console.error(chalk.red("[FATAL] خطأ في التشغيل:"), err.message);
  process.exit(1);
});

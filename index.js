"use strict";

/**
 * index.js — السكريبت الرئيسي للبوت
 * يعمل مباشرة بدون start.js أو داشبورد
 *
 * الترتيب:
 *  1. معالجة الأخطاء العامة
 *  2. تعريف المتغيرات العالمية
 *  3. الاتصال بـ MongoDB (Mongoose)
 *  4. خادم Express مصغّر (Keep-Alive لـ Render)
 *  5. تحميل الأوامر
 *  6. تسجيل الدخول وبدء الاستماع
 */

// ─── 0. معالجة الأخطاء العامة ────────────────────────────────
process.on("unhandledRejection", (reason) => {
  const msg = String(reason?.message || reason || "");
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

// ─── sqlite3 mock (يمنع خطأ native bindings) ─────────────────
require("./sqlite3-mock.js");

// ─── 1. التبعيات الأساسية ─────────────────────────────────────
const fs   = require("fs-extra");
const path = require("path");
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
global.db                = null;
global.maintenanceMode   = false;
global.disabledGroups    = {};

// ─── Logger ──────────────────────────────────────────────────
global.log = {
  info:    (msg) => console.log(chalk.blue("[INFO]"),     msg),
  warn:    (msg) => console.log(chalk.yellow("[WARN]"),   msg),
  error:   (msg) => console.log(chalk.red("[ERROR]"),     msg),
  success: (msg) => console.log(chalk.green("[SUCCESS]"), msg),
};

// ─── تحميل config.json ───────────────────────────────────────
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  global.config = { ...global.config, ...cfg, Prefix: cfg.Prefix || ["."] };
} catch { console.warn("[WARN] Using default config"); }

// ─── Role sets ────────────────────────────────────────────────
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
try {
  const p = path.join(__dirname, "appstate.json");
  if (fs.existsSync(p)) {
    global.appState = JSON.parse(fs.readFileSync(p, "utf8"));
    console.log(chalk.green("[BOT] ✅ تم تحميل appstate.json"));
  } else if (process.env.APPSTATE || process.env.APPSTATE_BOT1) {
    global.appState = JSON.parse(process.env.APPSTATE || process.env.APPSTATE_BOT1);
    console.log(chalk.green("[BOT] ✅ تم تحميل AppState من متغيرات البيئة"));
  } else {
    console.error(chalk.red("[FATAL] لم يُعثر على appstate — ضع appstate.json أو APPSTATE في البيئة"));
    process.exit(1);
  }
} catch (err) {
  console.error(chalk.red("[FATAL] فشل تحليل AppState:"), err.message);
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════
//  3. الاتصال بـ MongoDB (Mongoose)
// ══════════════════════════════════════════════════════════════
const { connectDB } = require("./db");

// ══════════════════════════════════════════════════════════════
//  4. خادم Express مصغّر — Keep-Alive فقط (بدون داشبورد)
// ══════════════════════════════════════════════════════════════
function startWebServer() {
  const express = require("express");
  const app     = express();

  app.get("/", (_req, res) => {
    const mem = process.memoryUsage();
    const up  = process.uptime();
    const h   = Math.floor(up / 3600);
    const m   = Math.floor((up % 3600) / 60);
    const s   = Math.floor(up % 60);
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

  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

  app.use((_req, res) => res.status(404).json({ error: "404" }));

  const PORT = parseInt(process.env.PORT || "3000", 10);
  app.listen(PORT, () =>
    console.log(chalk.green(`[WEB] ✅ Keep-Alive server على البورت ${PORT}`))
  );

  // Keep-Alive ping كل 14 دقيقة لمنع Render من Sleep
  setTimeout(() => {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    setInterval(() => {
      try {
        const mod = url.startsWith("https") ? require("https") : require("http");
        mod.get(url + "/health", (r) => {
          if (r.statusCode !== 200) console.warn("[KEEP-ALIVE] ⚠️", r.statusCode);
        }).on("error", () => {});
      } catch (_) {}
    }, 14 * 60 * 1000);
  }, 10_000);

  global.expressApp = app;
}

// ══════════════════════════════════════════════════════════════
//  5. تحميل الأوامر
// ══════════════════════════════════════════════════════════════
function loadCommands() {
  const dir = path.join(__dirname, "commands");
  if (!fs.existsSync(dir)) {
    console.error("[ERROR] مجلد commands غير موجود");
    return;
  }

  global.commands.clear();
  global.nonPrefixCommands.clear();
  global.eventCommands = [];

  const files = fs.readdirSync(dir).filter(
    (f) => f.endsWith(".js") && !fs.statSync(path.join(dir, f)).isDirectory()
  );

  for (const file of files) {
    try {
      const p = path.join(dir, file);
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
//  Message Handler
// ══════════════════════════════════════════════════════════════
const handleMessage = async (api, event) => {
  const { threadID, senderID, body, messageReply, messageID } = event;
  if (!body?.trim() || !messageID || !threadID || !senderID) return;
  if (global.disabledGroups?.[threadID]) return;

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
// ══════════════════════════════════════════════════════════════
async function main() {
  console.log(chalk.bold.green("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold.green("   🌿 Sunken Bot (Mongoose Edition)"));
  console.log(chalk.bold.green("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  // 1. الاتصال بـ MongoDB
  await connectDB();

  // 2. خادم Express (Keep-Alive)
  startWebServer();

  // 3. تحميل الأوامر
  loadCommands();

  // 4. تسجيل الدخول
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

    startListening(api);
    startMemoryCleanup();
  });
}

main().catch((err) => {
  console.error(chalk.red("[FATAL] خطأ في التشغيل:"), err.message);
  process.exit(1);
});

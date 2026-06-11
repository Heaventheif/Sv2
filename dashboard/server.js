"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const ROOT = process.env.BOT_ROOT || path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

const PATHS = {
  appstate1:      path.join(ROOT, "appstate.json"),
  appstate2:      path.join(ROOT, "appstate_bot2.json"),
  config:         path.join(ROOT, "config.json"),
  commands:       path.join(ROOT, "commands"),
  disabledCmds:   path.join(ROOT, "config", "disabledCommands.json"),
  disabledGroups: path.join(DATA_DIR, "disabled-groups.json"),
  groupsCache:    path.join(DATA_DIR, "groups-cache.json"),
  outbox:         path.join(DATA_DIR, "outbox.json"),
  sessionsMeta:   path.join(DATA_DIR, "sessions-meta.json"),
};

function rj(fp, fallback = null) {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch { return fallback; }
}

function wj(fp, data) {
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}

function loadCommandsFromDisk() {
  const disabled = new Set(rj(PATHS.disabledCmds, []));
  if (!fs.existsSync(PATHS.commands)) return [];
  return fs.readdirSync(PATHS.commands)
    .filter(f => f.endsWith(".js") && !fs.statSync(path.join(PATHS.commands, f)).isDirectory())
    .map(file => {
      try {
        const raw = fs.readFileSync(path.join(PATHS.commands, file), "utf-8");
        const name    = (raw.match(/name\s*:\s*["']([^"']+)["']/) || [])[1] || path.basename(file, ".js");
        const cat     = (raw.match(/category\s*:\s*["']([^"']+)["']/) || [])[1] || "عام";
        const role    = parseInt((raw.match(/role\s*:\s*(\d+)/) || [])[1] || "0");
        const cd      = parseInt((raw.match(/(?:countDown|cooldown)\s*:\s*(\d+)/) || [])[1] || "3");
        const aliases = ((raw.match(/aliases\s*:\s*\[([^\]]*)\]/) || [])[1] || "")
          .split(",").map(a => a.trim().replace(/["']/g, "")).filter(Boolean);
        return { name, category: cat, role, cooldown: cd, aliases, enabled: !disabled.has(name) };
      } catch { return null; }
    }).filter(Boolean);
}

app.use(express.static(PUBLIC_DIR));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), time: new Date().toISOString() });
});

app.get("/api/status", (_req, res) => {
  const cfg = rj(PATHS.config, {});
  const bot1 = fs.existsSync(PATHS.appstate1);
  const bot2 = fs.existsSync(PATHS.appstate2);
  const groups = rj(PATHS.groupsCache, {});
  const disabled = rj(PATHS.disabledGroups, {});
  res.json({
    botName: cfg.botName || "Shadow Garden Bot",
    prefix: Array.isArray(cfg.Prefix) ? cfg.Prefix[0] : "/",
    uptime: process.uptime(),
    sessions: {
      bot1: { active: bot1, label: "البوت الأول" },
      bot2: { active: bot2, label: "البوت الثاني" },
    },
    totalGroups: Object.keys(groups).length,
    disabledGroups: Object.values(disabled).filter(Boolean).length,
  });
});

app.get("/api/sessions", (_req, res) => {
  const meta = rj(PATHS.sessionsMeta, {});
  const bot1Exists = fs.existsSync(PATHS.appstate1);
  const bot2Exists = fs.existsSync(PATHS.appstate2);

  const sessions = {
    bot1: {
      id: "bot1",
      label: "البوت الأول",
      active: bot1Exists,
      updatedAt: bot1Exists ? fs.statSync(PATHS.appstate1).mtime.toISOString() : null,
      sizeBytes: bot1Exists ? fs.statSync(PATHS.appstate1).size : 0,
      note: meta.bot1?.note || "",
    },
    bot2: {
      id: "bot2",
      label: "البوت الثاني",
      active: bot2Exists,
      updatedAt: bot2Exists ? fs.statSync(PATHS.appstate2).mtime.toISOString() : null,
      sizeBytes: bot2Exists ? fs.statSync(PATHS.appstate2).size : 0,
      note: meta.bot2?.note || "",
    },
  };
  res.json(sessions);
});

app.post("/api/sessions/:botId", (req, res) => {
  const { botId } = req.params;
  const { appstate, note } = req.body;

  if (!["bot1", "bot2"].includes(botId)) {
    return res.status(400).json({ error: "botId يجب أن يكون bot1 أو bot2" });
  }
  if (!appstate) return res.status(400).json({ error: "appstate مطلوب" });

  let parsed;
  try { parsed = typeof appstate === "string" ? JSON.parse(appstate) : appstate; }
  catch { return res.status(400).json({ error: "AppState غير صالح — تأكد من صيغة JSON" }); }

  const targetPath = botId === "bot1" ? PATHS.appstate1 : PATHS.appstate2;
  wj(targetPath, parsed);

  const meta = rj(PATHS.sessionsMeta, {});
  meta[botId] = { note: note || "", updatedAt: new Date().toISOString() };
  wj(PATHS.sessionsMeta, meta);

  res.json({ success: true, message: `✅ تم تحديث ${botId === "bot1" ? "البوت الأول" : "البوت الثاني"} بنجاح` });
});

app.delete("/api/sessions/:botId", (req, res) => {
  const { botId } = req.params;
  const targetPath = botId === "bot1" ? PATHS.appstate1 : PATHS.appstate2;
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  const meta = rj(PATHS.sessionsMeta, {});
  delete meta[botId];
  wj(PATHS.sessionsMeta, meta);
  res.json({ success: true, message: `تم حذف جلسة ${botId}` });
});

app.get("/api/groups", (_req, res) => {
  const groups = rj(PATHS.groupsCache, {});
  const disabled = rj(PATHS.disabledGroups, {});
  const result = Object.entries(groups).map(([threadID, info]) => ({
    threadID,
    name: info.name || `مجموعة ${threadID.slice(-6)}`,
    participantCount: info.participantCount || 0,
    botId: info.botId || "bot1",
    enabled: !disabled[threadID],
    lastSeen: info.lastSeen || null,
  }));
  res.json(result);
});

app.post("/api/groups/toggle", (req, res) => {
  const { threadID, enabled } = req.body;
  if (!threadID) return res.status(400).json({ error: "threadID مطلوب" });
  const disabled = rj(PATHS.disabledGroups, {});
  if (enabled) delete disabled[threadID];
  else disabled[threadID] = true;
  wj(PATHS.disabledGroups, disabled);
  res.json({ success: true, threadID, enabled, message: enabled ? "✅ البوت مفعّل في المجموعة" : "⛔ البوت معطّل في المجموعة" });
});

app.post("/api/broadcast", (req, res) => {
  const { message, threadIDs } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });
  if (!Array.isArray(threadIDs) || threadIDs.length === 0) return res.status(400).json({ error: "يجب اختيار مجموعة واحدة على الأقل" });

  const outbox = rj(PATHS.outbox, []);
  const entry = {
    id: Date.now().toString(),
    message: message.trim(),
    threadIDs,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  outbox.push(entry);
  wj(PATHS.outbox, outbox);
  res.json({ success: true, id: entry.id, message: `📤 تمت إضافة الرسالة لقائمة الإرسال (${threadIDs.length} مجموعة)` });
});

app.get("/api/groups/disabled", (_req, res) => {
  res.json(rj(PATHS.disabledGroups, {}));
});

app.get("/api/config", (_req, res) => {
  const cfg = rj(PATHS.config, {});
  res.json({
    botName: cfg.botName || "Shadow Garden Bot",
    prefix: Array.isArray(cfg.Prefix) ? cfg.Prefix : ["/"],
    admins: cfg.admins || [],
    moderators: cfg.moderators || [],
    developers: cfg.developers || [],
    vips: cfg.vips || [],
  });
});

app.patch("/api/config", (req, res) => {
  const current = rj(PATHS.config, {});
  const { botName, prefix, admins, moderators, developers, vips } = req.body;
  const updated = {
    ...current,
    ...(botName !== undefined && { botName }),
    ...(prefix !== undefined && { Prefix: Array.isArray(prefix) ? prefix : [prefix] }),
    ...(admins !== undefined && { admins }),
    ...(moderators !== undefined && { moderators }),
    ...(developers !== undefined && { developers }),
    ...(vips !== undefined && { vips }),
  };
  wj(PATHS.config, updated);
  res.json({ success: true, config: updated });
});

app.get("/api/commands", (_req, res) => {
  res.json(loadCommandsFromDisk());
});

app.patch("/api/commands/:name/toggle", (req, res) => {
  const { name } = req.params;
  const { enabled } = req.body;
  const disabled = new Set(rj(PATHS.disabledCmds, []));
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  wj(PATHS.disabledCmds, Array.from(disabled));
  res.json({ success: true, name, enabled, message: enabled ? `✅ تم تفعيل الأمر ${name}` : `⛔ تم تعطيل الأمر ${name}` });
});

app.get("/api/render/envs", async (req, res) => {
  const { renderKey, serviceId } = req.query;
  if (!renderKey || !serviceId) return res.status(400).json({ error: "renderKey و serviceId مطلوبان" });

  try {
    const data = await renderApiGet(`/services/${serviceId}/env-vars`, renderKey);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/render/sync", async (req, res) => {
  const { renderKey, serviceId, envVars } = req.body;
  if (!renderKey || !serviceId || !envVars) return res.status(400).json({ error: "renderKey و serviceId و envVars مطلوبة" });

  try {
    const data = await renderApiPut(`/services/${serviceId}/env-vars`, renderKey, envVars);
    res.json({ success: true, data, message: "✅ تم تحديث متغيرات البيئة على Render" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats", (_req, res) => {
  const cmds = loadCommandsFromDisk();
  const cfg = rj(PATHS.config, {});
  const groups = rj(PATHS.groupsCache, {});
  const disabled = rj(PATHS.disabledGroups, {});
  res.json({
    commands: { total: cmds.length, enabled: cmds.filter(c => c.enabled).length },
    groups: { total: Object.keys(groups).length, disabled: Object.values(disabled).filter(Boolean).length },
    roles: {
      admins: (cfg.admins || []).length,
      moderators: (cfg.moderators || []).length,
      developers: (cfg.developers || []).length,
      vips: (cfg.vips || []).length,
    },
    uptime: process.uptime(),
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

function renderApiGet(endpoint, apiKey) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.render.com",
      path: `/v1${endpoint}`,
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    };
    const req = https.request(opts, r => {
      let body = "";
      r.on("data", d => body += d);
      r.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function renderApiPut(endpoint, apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: "api.render.com",
      path: `/v1${endpoint}`,
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, r => {
      let b = "";
      r.on("data", d => b += d);
      r.on("end", () => {
        try { resolve(JSON.parse(b)); } catch { resolve(b); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ─── لا تشغّل listen هنا — index.js يتولى ذلك ────────────────
// نصدّر app كـ router يُدمَج في خادم index.js الرئيسي
module.exports = app;

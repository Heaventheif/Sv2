"use strict";
/**
 * utils/ytRoutes.js
 * ─────────────────────────────────────────────────────────────
 * مسارات YouTube مُستخرَجة من index.js لتنظيف البنية
 * الاستخدام: require("./utils/ytRoutes")(app)
 */

const os   = require("os");
const path = require("path");
const axios = require("axios");
const fs    = require("fs-extra");
const { search, ytmp3, ytmp4 } = require("@vreden/youtube_scraper");
const { downloadToTemp, removeTempFile } = require("./mediaUtils");

function fmtDur(sec) {
  if (!sec) return "--";
  const m = Math.floor(sec / 60), s = sec % 60, h = Math.floor(m / 60);
  return h
    ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

module.exports = function registerYtRoutes(app) {
  // POST /yt/search
  app.post("/yt/search", async (req, res) => {
    try {
      const query = (req.body?.query || "").trim();
      const limit = Math.min(parseInt(req.body?.limit || 10), 15);
      if (!query) return res.status(400).json({ error: "query مطلوب" });

      const data = await search(query);
      if (!data.status || !data.results?.length)
        return res.status(404).json({ error: data.message || "لا توجد نتائج" });

      const results = data.results.slice(0, limit).map(v => ({
        id:       v.videoId || "",
        title:    v.title   || "بدون عنوان",
        url:      v.url     || `https://www.youtube.com/watch?v=${v.videoId}`,
        duration: v.timestamp || fmtDur(v.seconds) || "--",
        uploader: v.author?.name || v.channel || "",
        thumb:    v.thumbnail || v.image || "",
      }));
      res.json({ results });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  // POST /yt/audio → MP3
  app.post("/yt/audio", async (req, res) => {
    const url = (req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "url مطلوب" });
    let tmpPath = null;
    try {
      const data = await ytmp3(url, 128);
      if (!data.status || !data.download?.url)
        return res.status(503).json({ error: data.message || "فشل استخراج رابط الصوت" });

      const meta     = data.metadata || {};
      const title    = meta.title || "audio";
      const duration = meta.seconds || 0;
      const uploader = meta.author?.name || meta.channel || "";

      tmpPath = path.join(os.tmpdir(), `yt_a_${Date.now()}.mp3`);
      await downloadToTemp(data.download.url, ".mp3").then(p => { tmpPath = p; });
      if (!(await fs.stat(tmpPath)).size) throw new Error("الملف المُنزَّل فارغ");

      res.set({
        "Content-Type":        "audio/mpeg",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title)}.mp3"`,
        "X-Title":             encodeURIComponent(title),
        "X-Duration":          String(duration),
        "X-Uploader":          encodeURIComponent(uploader),
      });
      const stream = fs.createReadStream(tmpPath);
      stream.on("end",   () => removeTempFile(tmpPath));
      stream.on("error", () => removeTempFile(tmpPath));
      stream.pipe(res);
    } catch (e) {
      await removeTempFile(tmpPath);
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  // POST /yt/video → MP4
  app.post("/yt/video", async (req, res) => {
    const url = (req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "url مطلوب" });
    let tmpPath = null;
    try {
      const data = await ytmp4(url, 360);
      if (!data.status || !data.download?.url)
        return res.status(503).json({ error: data.message || "فشل استخراج رابط الفيديو" });

      const meta     = data.metadata || {};
      const title    = meta.title || "video";
      const duration = meta.seconds || 0;
      const uploader = meta.author?.name || meta.channel || "";

      tmpPath = await downloadToTemp(data.download.url, ".mp4");
      if (!(await fs.stat(tmpPath)).size) throw new Error("الملف المُنزَّل فارغ");

      res.set({
        "Content-Type":        "video/mp4",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title)}.mp4"`,
        "X-Title":             encodeURIComponent(title),
        "X-Duration":          String(duration),
        "X-Uploader":          encodeURIComponent(uploader),
      });
      const stream = fs.createReadStream(tmpPath);
      stream.on("end",   () => removeTempFile(tmpPath));
      stream.on("error", () => removeTempFile(tmpPath));
      stream.pipe(res);
    } catch (e) {
      await removeTempFile(tmpPath);
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  console.log(require("chalk").green("[SUCCESS] 🎵 YouTube routes جاهزة (/yt/search, /yt/audio, /yt/video)"));
};

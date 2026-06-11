const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// ─── تنظيف الكاش تلقائياً ───
if (!global.__tiktokCleanupRegistered) {
    global.__tiktokCleanupRegistered = true;
    setInterval(async () => {
        try {
            const dir = path.join(__dirname, '..', 'cache', 'tiktok');
            await fs.ensureDir(dir);
            const files = await fs.readdir(dir);
            const now = Date.now();
            for (const file of files) {
                const fp = path.join(dir, file);
                const stat = await fs.stat(fp);
                if (now - stat.mtimeMs > 300000) await fs.unlink(fp).catch(() => {});
            }
        } catch (_) {}
    }, 120000);
}

// ─── كشف روابط TikTok ───
function extractTikTokUrl(text) {
    const match = text.match(
        /https?:\/\/(?:(?:www|vm|vt)\.tiktok\.com|tiktok\.com)\/[^\s]*/i
    );
    return match ? match[0] : null;
}

module.exports = {
    config: {
        name: "tiktok",
        version: "1.0.0",
        author: "SunkenBot Developer",
        countDown: 10,
        role: 0,
        description: "تحميل تلقائي لفيديوهات TikTok بدون علامة مائية",
        category: "media",
        guides: "أرسل رابط TikTok في الشات"
    },

    onChat: async function({ api, event, message }) {
        const { threadID, senderID, body } = event;
        if (!body) return;

        const tiktokUrl = extractTikTokUrl(body);
        if (!tiktokUrl) return;

        // ─── رسالة انتظار ───
        message.reply("⏳ جاري تحميل الفيديو...");

        const cacheDir = path.join(__dirname, '..', 'cache', 'tiktok');
        await fs.ensureDir(cacheDir);
        const filePath = path.join(cacheDir, `${Date.now()}.mp4`);

        try {
            // ─── استدعاء TikWM API (مجاني، بدون مفتاح) ───
            const apiRes = await axios.post('https://www.tikwm.com/api/', null, {
                params: { url: tiktokUrl, hd: 1 },
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': 'application/json'
                }
            });

            if (process.env.DEBUG_MEDIA === 'true') {
                console.log('[TIKWM DEBUG]', JSON.stringify(apiRes.data, null, 2).slice(0, 800));
            }

            const data = apiRes.data?.data;
            if (!data) throw new Error("TikWM لم يُرجع بيانات.");

            // ─── أولوية: بدون علامة مائية ← HD ← عادي ───
            const videoUrl = data.hdplay || data.play || data.wmplay;
            if (!videoUrl) throw new Error("لم يُعثر على رابط فيديو.");

            const title  = data.title  || "TikTok Video";
            const author = data.author?.nickname || data.author?.unique_id || "";

            // ─── تحميل الفيديو كـ stream ───
            const streamRes = await axios({
                url: videoUrl,
                method: 'GET',
                responseType: 'stream',
                timeout: 90000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Referer': 'https://www.tiktok.com/'
                }
            });

            const writer = fs.createWriteStream(filePath);
            streamRes.data.pipe(writer);

            writer.on('finish', async () => {
                try {
                    const stats = fs.statSync(filePath);
                    if (stats.size === 0) throw new Error("الملف فارغ.");
                    if (stats.size > 26214400) {
                        return message.reply("⚠️ الفيديو أكبر من 25MB، لا يمكن إرساله عبر ماسنجر.");
                    }

                    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
                    await message.reply({
                        body: `✅ تم التحميل بنجاح!\n🎬 ${title}\n👤 ${author}\n📦 ${sizeMB} MB`,
                        attachment: fs.createReadStream(filePath)
                    });
                } catch (err) {
                    console.error("[TIKTOK] Send error:", err.message);
                    message.reply("❌ فشل إرسال الفيديو.");
                } finally {
                    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(_) {}
                }
            });

            writer.on('error', (err) => {
                console.error("[TIKTOK] Writer error:", err.message);
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(_) {}
                message.reply("❌ خطأ أثناء حفظ الفيديو.");
            });

            streamRes.data.on('error', (err) => {
                writer.destroy();
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(_) {}
                message.reply("❌ انقطع البث أثناء التحميل.");
            });

        } catch (error) {
            console.error("[TIKTOK] Error:", error.message);
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(_) {}
            message.reply("❌ فشل التحميل. تأكد من صحة الرابط أو حاول لاحقاً.");
        }
    },

    onStart: async function() {}
};

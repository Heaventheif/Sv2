<div align="center">

# 🌊 Sunken Bot — v2

بوت فيسبوك ماسنجر مبني على **[fca-unofficial (dongdev)](https://github.com/dongdev/fca-unofficial)** و **MongoDB (Mongoose)**

</div>

---

## 📋 المحتويات

- [هيكل المستودع](#-هيكل-المستودع)
- [الحصول على متغيرات البيئة](#-الحصول-على-متغيرات-البيئة)
- [الاستضافة على Render](#-الاستضافة-على-render)
- [فضاء Hugging Face](#-فضاء-hugging-face-فرع-hf-space)
- [الأوامر المتاحة](#-الأوامر-المتاحة)
- [هيكل الملفات](#-هيكل-الملفات)

---

## 📂 هيكل المستودع

المشروع يحتوي على **فرعين** في نفس المستودع:

| الفرع | المحتوى | يُنشر على |
|-------|---------|----------|
| `main` | كود البوت (Node.js) | Render |
| `hf-space` | خادم API الوسيط (Python/FastAPI) | Hugging Face Space |

> **الفكرة:** البوت على Render يرسل الطلبات إلى فضاء HF الذي يتعامل مع الـ AI APIs بدلاً منه.

---

## 🔑 الحصول على متغيرات البيئة

### 🔵 متغيرات فرع `main` (البوت على Render)

---

#### `APPSTATE` — جلسة الفيسبوك (مطلوب)
الـ AppState هو ملف كوكيز يمثّل جلسة حساب الفيسبوك الخاص بالبوت.

1. سجّل دخول حساب البوت على المتصفح
2. ثبّت إضافة **[c3c-fbstate](https://github.com/c3cbot/c3c-fbstate)** أو **[Get FB State](https://chrome.google.com/webstore/detail/get-fb-state)**
3. انقر على الإضافة واستخرج الـ state
4. انسخ المحتوى كاملاً — هذا هو قيمة `APPSTATE`

> أو ضع ملف `appstate.json` مباشرة بجانب `index.js`

---

#### `FB_EMAIL` و `FB_PASSWORD` — بيانات الدخول (احتياطي)
بريد وكلمة سر حساب البوت — يُستخدم فقط عند فشل الـ AppState تلقائياً.

---

#### `FB_2FA_SECRET` — مفتاح التحقق الثنائي (اختياري)
إذا كان حساب البوت مفعّلاً عليه المصادقة الثنائية (2FA):

1. اذهب إلى **إعدادات فيسبوك → الأمان وتسجيل الدخول → المصادقة الثنائية**
2. اختر **تطبيق المصادقة** → انقر **إعداد يدوي**
3. انسخ **المفتاح السري (Secret Key)** وضعه هنا

---

#### `MONGO_URI` — قاعدة البيانات (مطلوب للأوامر التي تحتاج DB)

1. اذهب إلى **[mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)** وأنشئ حساباً مجانياً
2. أنشئ **Cluster مجاني (M0)**
3. من **Database Access** → أضف مستخدماً وكلمة سر
4. من **Network Access** → أضف `0.0.0.0/0` للسماح بكل الاتصالات
5. من **Database** → **Connect** → **Drivers** → انسخ الرابط:
```
mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/sunkenbot
```

---

#### `CEREBRAS_API_KEY` — ذكاء اصطناعي Cerebras (أمر cerebras)

1. اذهب إلى **[cloud.cerebras.ai](https://cloud.cerebras.ai)**
2. سجّل حساباً → **API Keys** → **Create API Key**

---

#### `GITHUB_MODELS_TOKEN` — نماذج GitHub (أمر gptx)

1. اذهب إلى **[github.com/settings/tokens](https://github.com/settings/tokens)**
2. **Generate new token (classic)** → اختر صلاحية `read:user`

---

#### `TUMBLR_API_KEY` — فيديوهات Tumblr (أمر random)

1. اذهب إلى **[www.tumblr.com/oauth/apps](https://www.tumblr.com/oauth/apps)**
2. سجّل تطبيقاً جديداً → انسخ **Consumer Key**

---

#### `FERDEV_API_KEY` / `FERDEV_API_KEY2` / `FERDEV_API_KEY3` — موسيقى وصور (أمر sing, pinterest)

تواصل مع **FerDev** للحصول على مفاتيح API الخاصة بخدمته.

---

#### `HF_SPACE_URL` و `HF_SCRAPER_URL` — رابط فضاء HF (مطلوب لأوامر AI)

رابط فضائك على Hugging Face بعد نشره (انظر قسم [فضاء HF](#-فضاء-hugging-face-فرع-hf-space)):
```
HF_SPACE_URL    = https://YOUR-USERNAME-YOUR-SPACE-NAME.hf.space
HF_SCRAPER_URL  = https://YOUR-USERNAME-YOUR-SPACE-NAME.hf.space
```

| المتغير | يُستخدم في الأوامر |
|---------|-------------------|
| `HF_SPACE_URL` | groq, gemini, hf, img |
| `HF_SCRAPER_URL` | chess, novel |

---

### 🟢 متغيرات فرع `hf-space` (الفضاء على Hugging Face)

---

#### `GEMINI_API_KEY` / `GEMINI_API_KEY_2` / `GEMINI_API_KEY_3` / `GEMINI_API_KEY_4` — (plugin: gemini, groq كـ fallback)

يدعم الفضاء عدة مفاتيح للتناوب التلقائي عند استنفاد الحصة:

1. اذهب إلى **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)**
2. انقر **Create API key** — المفتاح مجاني مع حصة يومية

---

#### `GROQ_API_KEY` — (plugin: groq, gemini كـ fallback)

1. اذهب إلى **[console.groq.com/keys](https://console.groq.com/keys)**
2. **Create API Key** — مجاني مع حصة يومية سخية

---

#### `HF_TOKEN` — (plugin: hf, image)

مطلوب لاستخدام Hugging Face Inference API:

1. اذهب إلى **[huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)**
2. **New token** → نوع **Read** → انسخ التوكن

---

#### `SPACE_URL` — رابط الفضاء نفسه (للـ keepalive)

رابط فضائك الخاص لمنع نوم الـ Space:
```
SPACE_URL = https://YOUR-USERNAME-YOUR-SPACE-NAME.hf.space
```

---

#### `CF_WORKER_URL` — Cloudflare Worker كـ proxy (اختياري)

يُستخدم لتوجيه طلبات الـ scraping عبر Cloudflare لتجنب حظر IP.  
اذهب إلى **[workers.cloudflare.com](https://workers.cloudflare.com)** وأنشئ Worker جديداً، ثم ضع رابطه هنا:
```
CF_WORKER_URL = https://your-worker-name.workers.dev
```

---

## 🚀 الاستضافة على Render (فرع `main`)

### الخطوة 1 — رفع المشروع على GitHub
```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

> تأكد أن `appstate.json` مضاف إلى `.gitignore`

### الخطوة 2 — إنشاء خدمة على Render

1. اذهب إلى **[render.com](https://render.com)** وسجّل دخولاً
2. **New** → **Web Service** → اربط المستودع
3. اضبط الإعدادات:

| الحقل | القيمة |
|-------|--------|
| **Branch** | `main` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node --no-warnings index.js` |
| **Instance Type** | Free |

### الخطوة 3 — إضافة متغيرات البيئة على Render

من صفحة الخدمة → **Environment** → أضف:

```
APPSTATE              = [محتوى appstate.json كاملاً]
MONGO_URI             = mongodb+srv://...
FB_EMAIL              = email@example.com
FB_PASSWORD           = your_password
FB_2FA_SECRET         = (اختياري)
CEREBRAS_API_KEY      = (اختياري)
GITHUB_MODELS_TOKEN   = (اختياري)
TUMBLR_API_KEY        = (اختياري)
FERDEV_API_KEY        = (اختياري)
FERDEV_API_KEY2       = (اختياري)
FERDEV_API_KEY3       = (اختياري)
HF_SPACE_URL          = https://YOUR-USERNAME-YOUR-SPACE.hf.space
HF_SCRAPER_URL        = https://YOUR-USERNAME-YOUR-SPACE.hf.space
PORT                  = 3000
RENDER_EXTERNAL_URL   = https://your-app-name.onrender.com
NODE_OPTIONS          = --max-old-space-size=450
```

### الخطوة 4 — نشر البوت
انقر **Deploy** وانتظر حتى يظهر:
```
[LOGIN] ✅ تسجيل الدخول بـ AppState نجح
[DB] ✅ MongoDB متصل بنجاح
```

> ⚠️ الخطة المجانية تُوقف الخدمة بعد 15 دقيقة من عدم النشاط.  
> `RENDER_EXTERNAL_URL` يجعل البوت يطلب نفسه دورياً للبقاء نشطاً.

---

## 🤗 فضاء Hugging Face (فرع `hf-space`)

فضاء Docker على HF يعمل كخادم API وسيط بين البوت و AI APIs.  
يحتوي على 6 endpoints مبنية كـ plugins:

| Endpoint | Plugin | الوظيفة |
|----------|--------|---------|
| `POST /gemini` | gemini.py | Gemini 2.5 Flash + Google Search مع Groq كـ fallback |
| `POST /groq` | groq.py | Llama 4 Scout — نص + صور + صوت مع Gemini كـ fallback |
| `POST /hf` | hf.py | HuggingFace Inference API — نصوص + رؤية |
| `GET /hf/models` | hf.py | قائمة النماذج المتاحة |
| `POST /image` | image.py | توليد الصور (Text-to-Image) |
| `GET /image/models` | image.py | قائمة نماذج الصور |
| `POST /process_move` | chess.py | محرك الشطرنج |
| `GET /novel/search` | novel.py | بحث الروايات |
| `GET /novel/chapter` | novel.py | جلب فصل رواية |

### نشر الفضاء

1. اذهب إلى **[huggingface.co/spaces](https://huggingface.co/spaces)** → **Create new Space**
2. اختر:
   - **SDK:** Docker
   - **Visibility:** Public (مجاني)
3. ادفع فرع `hf-space` إلى الفضاء:

```bash
# أضف remote للفضاء
git remote add hf-space https://huggingface.co/spaces/YOUR-USERNAME/YOUR-SPACE-NAME

# ادفع فرع hf-space مباشرة
git subtree push --prefix=. hf-space main
```

أو بطريقة أبسط — انسخ محتويات فرع `hf-space` وارفعها مباشرة عبر واجهة HF.

4. بعد تشغيل الفضاء، ستحصل على الرابط:
```
https://YOUR-USERNAME-YOUR-SPACE-NAME.hf.space
```

### إضافة متغيرات الفضاء

من صفحة الفضاء → **Settings** → **Variables and secrets** → أضف:

```
GEMINI_API_KEY    = AIza...
GEMINI_API_KEY_2  = AIza...   (اختياري — للتناوب)
GEMINI_API_KEY_3  = AIza...   (اختياري)
GEMINI_API_KEY_4  = AIza...   (اختياري)
GROQ_API_KEY      = gsk_...
HF_TOKEN          = hf_...
SPACE_URL         = https://YOUR-USERNAME-YOUR-SPACE-NAME.hf.space
CF_WORKER_URL     = https://your-worker.workers.dev  (اختياري)
```

> بعد إضافة المتغيرات، أعد تشغيل الفضاء من **Settings** → **Factory reboot**

---

## 📜 الأوامر المتاحة

| الأمر | الوصف | المتغير المطلوب |
|-------|-------|----------------|
| `gemini` / `ai` | محادثة مع Gemini + بحث Google حي | `HF_SPACE_URL` + `GEMINI_API_KEY` في HF |
| `groq` / `ai2` | محادثة Llama 4 — نص + صور + صوت | `HF_SPACE_URL` + `GROQ_API_KEY` في HF |
| `gptx` | محادثة GPT عبر GitHub Models | `GITHUB_MODELS_TOKEN` |
| `cerebras` | محادثة عبر Cerebras AI | `CEREBRAS_API_KEY` |
| `hfai` | نماذج HuggingFace متعددة | `HF_SPACE_URL` + `HF_TOKEN` في HF |
| `hf` | تحويل نص لصوت | `HF_SPACE_URL` + `HF_TOKEN` في HF |
| `img` / `صورة` | توليد صور من النص | `HF_SPACE_URL` + `HF_TOKEN` في HF |
| `sing` / `mp3` | بحث وتحميل من SoundCloud | `FERDEV_API_KEY` |
| `pinterest` / `pin` | بحث صور Pinterest | `FERDEV_API_KEY` |
| `random` / `tumblr` | فيديو عشوائي من Tumblr | `TUMBLR_API_KEY` |
| `chess` / `شطرنج` | لعبة شطرنج رسومية | `HF_SCRAPER_URL` |
| `novel` / `رواية` | قراءة فصول روايات | `HF_SCRAPER_URL` |
| `tr` / `ترجمة` | ترجمة النص | — |
| `quran` | آيات قرآنية | — |
| `catfact` | حقائق عن القطط | — |
| `dogfact` | حقائق عن الكلاب | — |
| `adduser` / `اضافة` | إضافة عضو للمجموعة | — |
| `kick` / `طرد` | طرد عضو من المجموعة | — |
| `uid` | معرف المستخدم | — |
| `gid` | معرف المجموعة | — |
| `unsend` | سحب رسالة | — |
| `profile` | ملف المستخدم | `MONGO_URI` |
| `up` / `reload` | إعادة تحميل + إحصاءات | — |
| `help` / `الاوامر` | قائمة الأوامر | — |

---

## 📁 هيكل الملفات

```
── فرع main (البوت) ──────────────────────────────────
├── index.js              ← نقطة الدخول
├── package.json
├── config.json           ← الأدمنز والبادئة
├── fca-config.json
├── .env.example
├── appstate.json         ← لا ترفعه على Git
├── db/
│   ├── index.js          ← اتصال Mongoose
│   └── schemas.js        ← نماذج User/Group
├── commands/             ← جميع الأوامر
│   └── supportfunc/
└── utils/

── فرع hf-space (الفضاء) ────────────────────────────
├── Dockerfile            ← Docker + Playwright
├── main.py               ← FastAPI app
├── plugin_loader.py      ← يحمّل الـ plugins تلقائياً
├── keepalive.py          ← يمنع نوم الـ Space (SPACE_URL)
├── proxy_client.py       ← Cloudflare Worker proxy (CF_WORKER_URL)
├── browser.py            ← curl_cffi + rebrowser للـ scraping
├── requirements.txt
├── plugins/
│   ├── gemini.py         ← POST /gemini
│   ├── groq.py           ← POST /groq
│   ├── hf.py             ← POST /hf  GET /hf/models
│   ├── image.py          ← POST /image  GET /image/models
│   ├── chess.py          ← POST /process_move
│   ├── novel.py          ← GET /novel/search  GET /novel/chapter
│   └── requirements/     ← متطلبات كل plugin
├── bot_chess/
│   └── chess_engine.py
└── scrapers/
    └── wtr_lab.py        ← scraper روايات WTR-Lab
```

---

<div align="center">
مبني بـ ❤️ باستخدام <a href="https://github.com/dongdev/fca-unofficial">fca-unofficial (dongdev)</a> · <a href="https://www.mongodb.com/atlas">MongoDB Atlas</a> · <a href="https://huggingface.co/spaces">Hugging Face Spaces</a>
</div>

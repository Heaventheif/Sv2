# Sunken Bot — Mongoose Edition

بوت ماسنجر يعمل مع MongoDB (Mongoose) — بدون داشبورد، يشتغل مباشرة.

## التشغيل

```bash
npm install
node --no-warnings index.js
```

## الإعداد

1. أنشئ ملف `.env` من `.env.example`
2. أضف `appstate.json` في نفس المجلد (أو APPSTATE في متغيرات البيئة)
3. أضف `MONGO_URI` (اختياري — البوت يعمل بدونه)

## الأوامر (26 أمر)

| الأمر | الوصف | التصنيف |
|-------|-------|---------|
| gemini / بوت / ai | محادثة ذكية مع Gemini + رؤية الصور | ذكاء اصطناعي |
| groq / ai2 | محادثة مع Llama عبر Groq | ذكاء اصطناعي |
| gptx | محادثة GPT عبر GitHub Models | ذكاء اصطناعي |
| hfai | ذكاء اصطناعي عبر Hugging Face | ذكاء اصطناعي |
| img / صورة | توليد صور من النص | وسائط |
| sing / mp3 | بحث وتحميل من SoundCloud | وسائط |
| tiktok | تحميل فيديوهات TikTok | وسائط |
| pinterest / pin | بحث صور Pinterest | وسائط |
| random / tumblr | فيديو عشوائي من Tumblr | وسائط |
| hf | تحويل نص لصوت HF | وسائط |
| tr / ترجمة | ترجمة النص | أدوات |
| novel / رواية | قراءة فصول روايات مترجمة | أدوات |
| quran | آيات قرآنية | أدوات |
| catfact / قطة | حقائق عن القطط | مرح |
| dogfact | حقائق عن الكلاب | مرح |
| chess / شطرنج | لعبة شطرنج رسومية | ألعاب |
| adduser / اضافة | إضافة عضو للمجموعة | إدارة |
| kick / طرد | طرد عضو من المجموعة | إدارة |
| uid / ايدي | معرف المستخدم | أدوات |
| gid | معرف المجموعة | أدوات |
| unsend | سحب رسالة | أدوات |
| env | عرض متغيرات البيئة (مطورون) | إدارة |
| up / reload | إعادة تحميل + إحصاءات | إدارة |
| decor | تزيين النصوص | أدوات |
| help / الاوامر | قائمة الأوامر | أدوات |
| profile | ملف المستخدم (MongoDB) | أدوات |

## هيكل المشروع

```
bot/
├── index.js          ← نقطة الدخول (شغّله مباشرة)
├── package.json
├── config.json       ← الأدمنز والبادئة
├── fca-config.json
├── .env.example
├── appstate.json     ← ضعه هنا (غير مضمّن في Git)
├── db/
│   ├── index.js      ← اتصال Mongoose
│   └── schemas.js    ← نماذج User/Group
├── commands/         ← 26 أمر
│   └── supportFunc/
│       └── EnkiduReplyFunc.js
└── utils/
    └── translator.js
```

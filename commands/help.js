const fs = require("fs");
const path = require("path");

// 🗺️ خريطة دمج التصنيفات (تصنيفات متعددة ➜ عنوان واحد موحد)
const CATEGORY_MERGE = {
  "أوامر الإدارة والمشرفين": [
    "admin", "إشراف", "إدارة النظام", "Moderation 🛡️",
    "clearcache", "reload", "kick", "filteruser", "adduser", "antiout", "prefix"
  ],
  "أوامر الذكاء الاصطناعي": [
    "ذكاء اصطناعي", "ai", "gemini", "gptx", "groq"
  ],
  "أوامر الوسائط والتحميل": [
    "media", "وسائط", "تحميل", "ytdl", "sing", "autodl", "img", "ttk", "bratvid"
  ],
  "الأدوات المساعدة والمعلومات": [
    "أدوات", "tools", "help", "gid", "uid", "tr", "notes"
  ]
};

// 🏷️ أسماء بديلة تظهر بجانب الأمر في القائمة
const ALIAS_HINTS = {
  help: "مساعدة",
  kick: "طرد",
  adduser: "اضافة",
  sing: "mp3",
  img: "صورة",
  tr: "ترجمة",
  uid: "ايدي",
  gid: "معرف_المجموعة",
  gemini: "بوت",
  groq: "ai2"
};

module.exports = {
  config: {
    name: "help",
    description: "عرض جميع الأوامر أو معلومات عن أمر محدد",
    usage: "help أو help <أمر> أو help all",
    aliases: ["مساعدة", "الاوامر"],    category: "أدوات",
    role: 0,
    countDown: 3
  },

  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    const commandsDir = path.join(__dirname);

    if (!fs.existsSync(commandsDir)) {
      return api.sendMessage("❌ مجلد الأوامر غير موجود", threadID, null, messageID);
    }

    // 1️⃣ قراءة جميع الأوامر ديناميكياً
    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith(".js"));
    const loadedCommands = new Map();

    for (const file of commandFiles) {
      try {
        const cmd = require(path.join(commandsDir, file));
        const command = cmd.default || cmd;
        if (command.config?.name && (command.onStart || command.run || command.execute)) {
          const name = command.config.name.toLowerCase();
          // تجنب التكرار (نفس الأمر قد يظهر بأسماء مستعارة)
          if (!loadedCommands.has(name)) {
            loadedCommands.set(name, {
              name,
              category: command.config.category || "غير مصنف",
              description: command.config.shortDescription?.ar
                || command.config.description
                || "لا يوجد وصف",
              aliases: command.config.aliases || []
            });
          }
        }
      } catch (e) {
        // تجاهل الأخطاء في تحميل ملف واحد
      }
    }

    // 2️⃣ إذا طلب المستخدم تفاصيل أمر محدد
    if (args.length > 0 && args[0].toLowerCase() !== "all") {
      const cmdName = args[0].toLowerCase();
      const cmd = loadedCommands.get(cmdName);
      if (cmd) {
        const info =
          `📌 ${cmd.name}\n` +
          `📂 التصنيف: ${cmd.category}\n` +
          `📝 الوصف: ${cmd.description}\n` +
          (cmd.aliases.length > 0 ? `🔗 البدائل: ${cmd.aliases.join(", ")}\n` : "") +          `️ الكولداون: ${cmd.config?.countDown || cmd.config?.cooldown || 3} ثانية\n` +
          `🔐 الصلاحية: ${getRoleName(cmd.config?.role || 0)}`;
        return api.sendMessage(info, threadID, null, messageID);
      }
      return api.sendMessage(`❌ الأمر "${cmdName}" غير موجود`, threadID, null, messageID);
    }

    // 3️⃣ عرض جميع الأوامر كقائمة بسيطة
    if (args[0]?.toLowerCase() === "all") {
      let allCommands = ` جميع الأوامر (${loadedCommands.size} أمر):\n\n`;
      let idx = 1;
      for (const cmd of loadedCommands.values()) {
        allCommands += `${idx}. ${cmd.name}\n`;
        idx++;
      }
      return api.sendMessage(allCommands, threadID, null, messageID);
    }

    // 4️ بناء الرسالة الرئيسية بالتنسيق المطلوب
    const totalCommands = loadedCommands.size;
    let message =
      `~×~×~×~×~×~×~×~×~×~×~×~×~×~×~×~\n` +
      `  ★ لوحة التحكم والأوامر (${totalCommands} أمر) ★\n` +
      `~×~×~×~×~×~×~×~×~×~×~×~×~×~×~×~`;

    const usedCommands = new Set();
    const otherCommands = [];

    // المرور على كل تصنيف موحد
    for (const [categoryTitle, categoryItems] of Object.entries(CATEGORY_MERGE)) {
      // جمع الأوامر الموجودة فعلياً في هذا التصنيف
      const present = [];
      for (const item of categoryItems) {
        const lowerItem = item.toLowerCase();
        // قد يكون العنصر اسم أمر أو اسم تصنيف
        if (loadedCommands.has(lowerItem)) {
          present.push(loadedCommands.get(lowerItem));
        } else {
          // ابحث عن الأوامر التي تصنيفها يطابق هذا العنصر
          for (const cmd of loadedCommands.values()) {
            if (cmd.category.toLowerCase() === lowerItem && !usedCommands.has(cmd.name)) {
              present.push(cmd);
            }
          }
        }
      }

      if (present.length === 0) continue;

      message += `\n\n ${categoryTitle}\n______\n`;      for (const cmd of present) {
        if (usedCommands.has(cmd.name)) continue;
        const aliasHint = ALIAS_HINTS[cmd.name]
          ? ` (أو ${ALIAS_HINTS[cmd.name]})`
          : "";
        message += ` • ${cmd.name}${aliasHint} ───★ ${cmd.description}.\n`;
        usedCommands.add(cmd.name);
      }
    }

    // أي أمر لم يُدرَج في التصنيفات الموحدة ➜ قسم "أوامر أخرى"
    for (const cmd of loadedCommands.values()) {
      if (!usedCommands.has(cmd.name)) {
        otherCommands.push(cmd);
      }
    }

    if (otherCommands.length > 0) {
      message += `\n\n أوامر أخرى\n______\n`;
      for (const cmd of otherCommands) {
        const aliasHint = ALIAS_HINTS[cmd.name]
          ? ` (أو ${ALIAS_HINTS[cmd.name]})`
          : "";
        message += ` • ${cmd.name}${aliasHint} ───★ ${cmd.description}.\n`;
      }
    }

    message += `\n~×~×~×~×~×~×~×~×~×~×~×~×~×~×~×~\n`;
    message += `  اكتب: help <اسم_الأمر> لعرض تفاصيله\n`;
    message += ` 💡 اكتب: help all لعرض القائمة البسيطة`;

    return api.sendMessage(message, threadID, null, messageID);
  }
};

function getRoleName(role) {
  const roles = {
    0: "الجميع 👥",
    1: "المشرفون 🛡️",
    2: "المراقبون ️",
    3: "الأعضاء المميزون 👑",
    4: "المطورون 🔧"
  };
  return roles[role] || "غير محدد";
}

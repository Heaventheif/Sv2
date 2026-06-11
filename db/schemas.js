"use strict";

/**
 * db/schemas.js
 * تعريف هياكل البيانات (Schemas) لـ MongoDB باستخدام Mongoose
 *
 * الاستخدام داخل أي أمر:
 *   const { UserModel, GroupModel } = require("../db/schemas");
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;

// ══════════════════════════════════════════════════
//  1. مخطط المستخدم (UserSchema)
// ══════════════════════════════════════════════════
const UserSchema = new Schema(
  {
    // المعرّف الفريد للمستخدم على فيسبوك
    facebookId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    // الاسم الكامل (يُجلب من الحدث ويُحدَّث تلقائياً)
    name: {
      type:    String,
      default: "مستخدم",
      trim:    true,
    },

    // رصيد العملات الافتراضية
    money: {
      type:    Number,
      default: 0,
      min:     0,
    },

    // نقاط الخبرة
    xp: {
      type:    Number,
      default: 0,
      min:     0,
    },

    // مستوى المستخدم (يُحسب من XP)
    level: {
      type:    Number,
      default: 1,
      min:     1,
    },

    // عدد الرسائل الإجمالي
    messageCount: {
      type:    Number,
      default: 0,
    },

    // دور المستخدم (0=عادي، 1=مشرف، 2=مودراتور، 3=VIP، 4=مطور)
    role: {
      type:    Number,
      default: 0,
      enum:    [0, 1, 2, 3, 4],
    },

    // هل المستخدم محظور؟
    banned: {
      type:    Boolean,
      default: false,
    },

    // سبب الحظر (اختياري)
    banReason: {
      type:    String,
      default: null,
    },

    // آخر ظهور للمستخدم
    lastSeen: {
      type:    Date,
      default: Date.now,
    },
  },
  {
    // إضافة createdAt و updatedAt تلقائياً
    timestamps: true,
    // اسم المجموعة في MongoDB
    collection: "users",
  }
);

// ─── دالة مساعدة: حساب المستوى من XP ────────────────────
UserSchema.methods.calculateLevel = function () {
  this.level = Math.floor(Math.sqrt(this.xp / 100)) + 1;
};

// ─── دالة مساعدة: إضافة XP وتحديث المستوى ───────────────
UserSchema.methods.addXP = async function (amount) {
  this.xp += amount;
  const newLevel = Math.floor(Math.sqrt(this.xp / 100)) + 1;
  const levelUp  = newLevel > this.level;
  this.level = newLevel;
  await this.save();
  return { levelUp, newLevel };
};

// ══════════════════════════════════════════════════
//  2. مخطط المجموعة (GroupSchema)
// ══════════════════════════════════════════════════
const GroupSchema = new Schema(
  {
    // معرّف الخيط (Thread ID) على فيسبوك
    threadId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    // اسم المجموعة
    name: {
      type:    String,
      default: "مجموعة",
      trim:    true,
    },

    // هل البوت مفعّل في هذه المجموعة؟
    botEnabled: {
      type:    Boolean,
      default: true,
    },

    // البادئة المخصصة للمجموعة (تُلغي البادئة العامة)
    prefix: {
      type:    String,
      default: null,
    },

    // قائمة الأعضاء المحظورين في هذه المجموعة تحديداً
    bannedUsers: {
      type:    [String],
      default: [],
    },

    // إعدادات مخصصة (قابلة للتوسيع)
    settings: {
      antiout:     { type: Boolean, default: false },
      antilink:    { type: Boolean, default: false },
      welcomeMsg:  { type: Boolean, default: false },
    },

    // عدد الرسائل التي تمت معالجتها
    messageCount: {
      type:    Number,
      default: 0,
    },

    // آخر نشاط
    lastActive: {
      type:    Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "groups",
  }
);

// ══════════════════════════════════════════════════
//  3. تصدير الموديلات
//     نستخدم "mongoose.models.X || mongoose.model(...)"
//     لمنع خطأ "Cannot overwrite model once compiled"
//     الذي يحدث عند استخدام hot-reload.
// ══════════════════════════════════════════════════
const UserModel  = mongoose.models.User  || mongoose.model("User",  UserSchema);
const GroupModel = mongoose.models.Group || mongoose.model("Group", GroupSchema);

module.exports = { UserModel, GroupModel };

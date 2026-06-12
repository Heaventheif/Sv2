module.exports = {
  config: {
    name: "debugevent",
    aliases: ["de"],
    version: "1.1",
    role: 0,
    countDown: 0,
    category: "dev"
  },
  onChat: async ({ api, event }) => {
    // يلتقط كل رسالة ويطبع بنيتها في اللوغ
    const info = {
      body:        event.body || "(فارغ)",
      type:        event.type,
      attachments: event.attachments?.map(a => ({
        type:       a.type,
        url:        a.url        || null,
        previewUrl: a.previewUrl || null,
        shareUrl:   a.shareUrl   || null,
        source:     a.source     || null,
        title:      a.title      || null,
        description:a.description|| null,
      })),
    };
    console.log("[DEBUG EVENT]", JSON.stringify(info, null, 2));
    // أرسل للمحادثة نفسها أيضاً
    api.sendMessage("📋 EVENT:\n" + JSON.stringify(info, null, 2), event.threadID);
  }
};

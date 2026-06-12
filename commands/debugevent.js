module.exports = {
  config: {
    name: "debugevent",
    aliases: ["de"],
    version: "1.0",
    role: 4,
    countDown: 0,
    category: "dev"
  },
  onChat: async ({ api, event }) => {
    if (!event.body?.includes("debug")) return;
    const info = {
      body:        event.body,
      type:        event.type,
      attachments: event.attachments?.map(a => ({
        type:        a.type,
        url:         a.url,
        previewUrl:  a.previewUrl,
        ID:          a.ID,
        filename:    a.filename,
        description: a.description,
      })),
      messageReply: event.messageReply ? "موجود" : "لا",
    };
    api.sendMessage(JSON.stringify(info, null, 2), event.threadID);
  }
};

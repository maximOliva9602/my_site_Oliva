/* console-драйвер: нічого не шле, лише логує. Локальний дефолт.
   Одразу віддає статус 'delivered' (для перевірки пайплайну). */
let seq = 1;

module.exports = {
  name: "console",
  async sendMessage(opts) {
    const id = "console_" + (seq++);
    console.log(`[notify:console] -> ${opts.phone}\n${opts.text}\n(id=${id})`);
    return { providerMsgId: id, channel: "console" };
  },
  parseStatus(payload) {
    return { providerMsgId: payload.id, status: payload.status || "delivered", channel: "console" };
  },
  async pollStatus(ids) {
    return ids.map(function (id) { return { providerMsgId: id, status: "delivered", channel: "console" }; });
  },
};

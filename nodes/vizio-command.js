'use strict';
const { resolveCommand, execute } = require('../lib/commands');

module.exports = function (RED) {
  function VizioCommandNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const tv = RED.nodes.getNode(config.tv);
    if (!tv) { node.status({ fill: 'red', shape: 'ring', text: 'no TV configured' }); return; }

    node.on('input', async (msg, send, done) => {
      send = send || node.send.bind(node);
      done = done || ((e) => e && node.error(e, msg));
      try {
        const cmd = resolveCommand({ action: config.action, amount: config.amount, input: config.input, volume: config.volume, codeset: config.codeset, code: config.code }, msg.payload);
        const result = await tv.run((c) => execute(c, cmd));
        node.status({ fill: 'green', shape: 'dot', text: cmd.action });
        msg.payload = { ok: true, ...result };
        send(msg);
        done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 40) });
        done(err);
      }
    });
  }
  RED.nodes.registerType('vizio-command', VizioCommandNode);
};

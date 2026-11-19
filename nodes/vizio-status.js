'use strict';
const { readStatus } = require('../lib/commands');

module.exports = function (RED) {
  function VizioStatusNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const tv = RED.nodes.getNode(config.tv);
    if (!tv) { node.status({ fill: 'red', shape: 'ring', text: 'no TV configured' }); return; }

    node.on('input', async (msg, send, done) => {
      send = send || node.send.bind(node);
      done = done || ((e) => e && node.error(e, msg));
      try {
        const s = await tv.run((c) => readStatus(c));
        node.status({ fill: s.power ? 'green' : 'grey', shape: 'dot', text: s.power ? `on · ${s.input || '?'} · vol ${s.volume ?? '?'}` : 'off' });
        msg.payload = s;
        send(msg);
        done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 40) });
        done(err);
      }
    });
  }
  RED.nodes.registerType('vizio-status', VizioStatusNode);
};

'use strict';
const crypto = require('crypto');
const { VizioClient } = require('../lib/api');
const { discover } = require('../lib/discover');

module.exports = function (RED) {
  const REDISCOVER_MIN_INTERVAL_MS = 60000;

  function VizioTvNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.host = config.host;
    node.port = Number(config.port) || 7345;
    node.tvId = config.tvId;
    node.lastRediscover = 0;
    node.client = new VizioClient({
      host: node.host, port: node.port, authToken: node.credentials && node.credentials.authToken,
      deviceId: config.deviceId, deviceName: config.deviceName || 'Node-RED'
    });

    /**
     * Run fn(client). If the TV is unreachable and we know its mDNS id, look for it
     * again (it may have a new DHCP address) and retry once.
     */
    node.run = async function (fn) {
      try {
        return await fn(node.client);
      } catch (err) {
        const canRetry = err.isConnectionError && node.tvId && Date.now() - node.lastRediscover > REDISCOVER_MIN_INTERVAL_MS;
        if (!canRetry) throw err;
        node.lastRediscover = Date.now();
        const tvs = await (node.discoverFn || discover)();
        const tv = tvs.find((t) => t.tvId === node.tvId);
        if (!tv || tv.host === node.client.host) throw err;
        node.warn(`TV moved from ${node.client.host} to ${tv.host}. Update the TV config node (or set a DHCP reservation).`);
        node.client.host = tv.host;
        node.client.port = tv.port || node.client.port;
        return fn(node.client);
      }
    };
  }

  RED.nodes.registerType('vizio-tv', VizioTvNode, { credentials: { authToken: { type: 'password' } } });

  // ---- admin endpoints used by the editor (stateless: everything comes in the request) ----
  const clientFrom = (b) => new VizioClient({ host: b.host, port: b.port, deviceId: b.deviceId, deviceName: b.deviceName || 'Node-RED' });
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); } catch (e) {
      // e.userError: our own validation (4xx); anything else is a failure talking to the TV (502)
      res.status(e.userError || 502).json({ error: e.message });
    }
  };
  const needHost = (b) => { if (!b || !b.host || !b.deviceId) { const e = new Error('host and deviceId are required'); e.userError = 400; throw e; } };

  RED.httpAdmin.get('/vizio-remote/discover', RED.auth.needsPermission('vizio-tv.read'), wrap(() => discover()));

  RED.httpAdmin.post('/vizio-remote/pair/start', RED.auth.needsPermission('vizio-tv.write'), wrap((req) => { needHost(req.body); return clientFrom(req.body).pairStart(); }));

  RED.httpAdmin.post('/vizio-remote/pair/finish', RED.auth.needsPermission('vizio-tv.write'), wrap((req) => {
    needHost(req.body);
    if (!req.body.pin) { const e = new Error('pin is required'); e.userError = 400; throw e; }
    return clientFrom(req.body).pairFinish(req.body);
  }));

  RED.httpAdmin.post('/vizio-remote/pair/cancel', RED.auth.needsPermission('vizio-tv.write'), wrap(async (req) => {
    needHost(req.body);
    await clientFrom(req.body).pairCancel(req.body.challengeType);
    return { ok: true };
  }));

  RED.httpAdmin.get('/vizio-remote/new-device-id', RED.auth.needsPermission('vizio-tv.read'), (req, res) =>
    res.json({ deviceId: 'node-red-' + crypto.randomBytes(4).toString('hex') }));
};

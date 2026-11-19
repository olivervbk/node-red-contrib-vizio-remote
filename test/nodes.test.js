'use strict';
const assert = require('assert');
const helper = require('node-red-node-test-helper');
const { startStub } = require('./stub-tv');

helper.init(require.resolve('node-red'));

describe('Node-RED nodes', function () {
  this.timeout(15000);
  let tv;
  before(async () => { tv = await startStub(); });
  after(() => tv.close());
  beforeEach((done) => { tv.state.keys.length = 0; helper.startServer(done); });
  afterEach((done) => { helper.unload().then(() => helper.stopServer(done)); });

  const nodes = [require('../nodes/vizio-tv'), require('../nodes/vizio-command'), require('../nodes/vizio-status')];
  const flow = (extra = {}) => [
    { id: 'tv', type: 'vizio-tv', host: '127.0.0.1', port: tv.port, deviceId: 'd', tvId: extra.tvId },
    { id: 'cmd', type: 'vizio-command', tv: 'tv', action: 'volume_up', amount: 2, wires: [['out']] },
    { id: 'st', type: 'vizio-status', tv: 'tv', wires: [['out']] },
    { id: 'out', type: 'helper' }
  ];
  const msgFlow = (cfg) => [
    { id: 'tv', type: 'vizio-tv', host: '127.0.0.1', port: tv.port, deviceId: 'd' },
    { id: 'cmd', type: 'vizio-command', tv: 'tv', wires: [['out']], ...cfg },
    { id: 'out', type: 'helper' }
  ];
  const creds = { tv: { authToken: 'TESTTOKEN' } };

  it('command node sends keys and outputs result', async () => {
    await helper.load(nodes, flow(), creds);
    const out = helper.getNode('out');
    const got = new Promise((r) => out.on('input', r));
    helper.getNode('cmd').receive({ payload: { action: 'volume_down', amount: 2 } });
    const msg = await got;
    assert.deepStrictEqual(msg.payload, { ok: true, action: 'volume_down', amount: 2 });
    assert.deepStrictEqual(tv.state.keys, [[5, 0], [5, 0]]);
  });

  it('status node outputs state', async () => {
    await helper.load(nodes, flow(), creds);
    const got = new Promise((r) => helper.getNode('out').on('input', r));
    helper.getNode('st').receive({});
    const msg = await got;
    assert.strictEqual(msg.payload.power, true);
  });

  it('errors reach Catch via done(err)', async () => {
    await helper.load(nodes, flow(), { tv: { authToken: 'bad' } });
    const cmd = helper.getNode('cmd');
    const logged = new Promise((r) => cmd.on('call:error', r));
    cmd.receive({ payload: 'mute_on' });
    await logged;
  });

  it('rediscovers a moved TV and retries once', async () => {
    await helper.load(nodes, flow({ tvId: 'did-1' }), creds);
    const tvNode = helper.getNode('tv');
    tvNode.client.host = '127.0.0.2'; // wrong address, nothing listening on stub port there? (stub binds 127.0.0.1 only)
    tvNode.client.timeout = 800;
    tvNode.discoverFn = async () => [{ tvId: 'did-1', host: '127.0.0.1', port: tv.port }];
    const got = new Promise((r) => helper.getNode('out').on('input', r));
    helper.getNode('st').receive({});
    const msg = await got;
    assert.strictEqual(msg.payload.power, true);
    assert.strictEqual(tvNode.client.host, '127.0.0.1');
  });

  const run = async (cfg, msg) => {
    await helper.load(nodes, msgFlow(cfg), creds);
    const got = new Promise((r) => helper.getNode('out').on('input', r));
    helper.getNode('cmd').receive(msg);
    return got;
  };

  it('action from msg: "PowerOn" string', async () => {
    const m = await run({ action: 'msg' }, { payload: 'PowerOn' });
    assert.strictEqual(m.payload.action, 'power_on');
    assert.deepStrictEqual(tv.state.keys, [[11, 1]]);
  });

  it('action from msg without an action raises an error', async () => {
    await helper.load(nodes, msgFlow({ action: 'msg' }), creds);
    const cmd = helper.getNode('cmd');
    const logged = new Promise((r) => cmd.on('call:error', r));
    cmd.receive({ payload: 12345 });
    await logged;
  });

  it('numeric payload overrides configured volume for volume_set', async () => {
    const m = await run({ action: 'volume_set', volume: '20', volumeType: 'num' }, { payload: 42 });
    assert.strictEqual(m.payload.volume, 42);
    assert.strictEqual(tv.state.volume, 42);
  });

  it('typed parameter reads from a msg property; payload object overrides it', async () => {
    let m = await run({ action: 'volume_set', volume: 'level', volumeType: 'msg' }, { payload: 'go', level: 33 });
    assert.strictEqual(m.payload.volume, 33);
    await helper.unload();
    m = await run({ action: 'volume_set', volume: 'level', volumeType: 'msg' }, { payload: { volume: 15 }, level: 33 });
    assert.strictEqual(m.payload.volume, 15);
  });

  it('fixed action ignores a stray string payload', async () => {
    const m = await run({ action: 'mute_toggle' }, { payload: 'ON' });
    assert.strictEqual(m.payload.action, 'mute_toggle');
  });

  describe('admin endpoints', () => {
    const request = require('supertest');
    it('pair/start + pair/finish round trip, and validation', async () => {
      await helper.load(nodes, [], {});
      const r = request(helper._httpAdmin);
      const body = { host: '127.0.0.1', port: tv.port, deviceId: 'd1' };
      const s = await r.post('/vizio-remote/pair/start').send(body).expect(200);
      assert.deepStrictEqual(s.body, { pairingReqToken: 42, challengeType: 1 });
      const f = await r.post('/vizio-remote/pair/finish').send({ ...body, ...s.body, pin: tv.pin }).expect(200);
      assert.strictEqual(f.body.authToken, tv.token);
      const bad = await r.post('/vizio-remote/pair/finish').send({ ...body, ...s.body, pin: '9999' });
      assert.strictEqual(bad.status, 502);
      assert.match(bad.body.error, /Wrong PIN/);
      await r.post('/vizio-remote/pair/start').send({}).expect(400);
    });
  });
});

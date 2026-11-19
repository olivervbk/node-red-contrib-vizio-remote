'use strict';
const assert = require('assert');
const { VizioClient } = require('../lib/api');
const { resolveCommand, execute, readStatus } = require('../lib/commands');
const { discover } = require('../lib/discover');
const { startStub } = require('./stub-tv');

describe('VizioClient + commands (against stub TV)', function () {
  this.timeout(10000);
  let tv, client;
  before(async () => { tv = await startStub(); });
  after(() => tv.close());
  beforeEach(() => {
    tv.state.requests.length = 0; tv.state.keys.length = 0;
    client = new VizioClient({ host: '127.0.0.1', port: tv.port, authToken: tv.token, deviceId: 'dev1' });
  });

  it('pairs: start then finish returns token', async () => {
    const anon = new VizioClient({ host: '127.0.0.1', port: tv.port, deviceId: 'dev1', deviceName: 'T' });
    const s = await anon.pairStart();
    assert.deepStrictEqual(s, { pairingReqToken: 42, challengeType: 1 });
    const f = await anon.pairFinish({ pin: '1234', ...s });
    assert.strictEqual(f.authToken, tv.token);
    const fin = tv.state.requests.find((r) => r.url === '/pairing/pair');
    assert.strictEqual(fin.body.DEVICE_ID, 'dev1');
    assert.strictEqual(fin.body.PAIRING_REQ_TOKEN, 42);
  });

  it('rejects a wrong PIN with a useful error', async () => {
    const anon = new VizioClient({ host: '127.0.0.1', port: tv.port, deviceId: 'dev1' });
    await assert.rejects(anon.pairFinish({ pin: '0000', pairingReqToken: 42 }), /Wrong PIN/);
  });

  it('rejects an invalid token', async () => {
    client.authToken = 'nope';
    await assert.rejects(client.getPower(), /BLOCKED/);
  });

  it('reports connection errors as such', async () => {
    const dead = new VizioClient({ host: '127.0.0.1', port: 1, authToken: 'x', timeout: 500 });
    await assert.rejects(dead.getPower(), (e) => e.isConnectionError);
  });

  it('volume_up x3 sends three presses of VOL_UP', async () => {
    await execute(client, resolveCommand({ action: 'volume_up', amount: 3 }), { repeatDelay: 1 });
    assert.deepStrictEqual(tv.state.keys, [[5, 1], [5, 1], [5, 1]]);
  });

  it('string payload overrides config; object payload overrides amount', async () => {
    assert.strictEqual(resolveCommand({ action: 'play' }, 'Mute Toggle').action, 'mute_toggle');
    const c = resolveCommand({ action: 'volume_down', amount: 1 }, { amount: 4 });
    assert.deepStrictEqual([c.action, c.amount], ['volume_down', 4]);
  });

  it('power / mute / playback keys map to the right codes', async () => {
    for (const a of ['power_on', 'power_off', 'mute_toggle', 'play', 'pause']) await execute(client, { action: a });
    assert.deepStrictEqual(tv.state.keys, [[11, 1], [11, 0], [5, 4], [2, 3], [2, 2]]);
  });

  it('raw key works and validates', async () => {
    await execute(client, { action: 'key', codeset: 5, code: 1 });
    assert.deepStrictEqual(tv.state.keys, [[5, 1]]);
    await assert.rejects(execute(client, { action: 'key' }), /codeset/);
  });

  it('volume_set uses HASHVAL and clamps', async () => {
    const r = await execute(client, { action: 'volume_set', volume: 150 });
    assert.strictEqual(r.volume, 100);
    assert.strictEqual(tv.state.volume, 100);
    const put = tv.state.requests.find((x) => x.method === 'PUT' && x.url.endsWith('/volume'));
    assert.deepStrictEqual(put.body, { REQUEST: 'MODIFY', VALUE: 100, HASHVAL: 111 });
  });

  it('input_set resolves names, cnames, labels and SmartCast', async () => {
    assert.strictEqual((await execute(client, { action: 'input_set', input: 'hdmi1' })).input, 'HDMI-1');
    assert.strictEqual((await execute(client, { action: 'input_set', input: 'Game Console' })).input, 'HDMI-2');
    assert.strictEqual((await execute(client, { action: 'input_set', input: 'SmartCast' })).input, 'CAST');
    assert.strictEqual(tv.state.inputHash, 222);
    await assert.rejects(execute(client, { action: 'input_set', input: 'HDMI-9' }), /Unknown input.*Available/);
  });

  it('unknown action lists valid ones', async () => {
    await assert.rejects(execute(client, { action: 'stop' }), /Unknown action "stop"/);
  });

  it('readStatus returns power, input, label, volume, muted', async () => {
    tv.state.input = 'HDMI-2';
    assert.deepStrictEqual(await readStatus(client), { power: true, input: 'HDMI-2', inputLabel: 'Game Console', volume: tv.state.volume, muted: false });
  });

  it('readStatus when off returns only power', async () => {
    tv.state.power = 0;
    assert.deepStrictEqual(await readStatus(client), { power: false });
    tv.state.power = 1;
  });
});

describe('discover (mocked mDNS)', () => {
  it('maps _viziocast records', async () => {
    const factory = () => ({
      find: (_o, cb) => { cb({ name: 'x', port: 7345, addresses: ['fe80::1', '10.0.0.5'], txt: { name: 'Den', mdl: 'E55-E1', did: 'abc', hsp: '7345' } }); return { stop() {} }; },
      destroy() {}
    });
    assert.deepStrictEqual(await discover({ timeout: 5, factory }), [{ name: 'Den', host: '10.0.0.5', port: 7345, model: 'E55-E1', tvId: 'abc' }]);
  });
});

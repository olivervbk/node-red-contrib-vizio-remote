'use strict';
const https = require('https');
const KEYS = require('./keys');

const PATHS = {
  pairStart: '/pairing/start',
  pairFinish: '/pairing/pair',
  pairCancel: '/pairing/cancel',
  keyPress: '/key_command/',
  power: '/state/device/power_mode',
  inputs: '/menu_native/dynamic/tv_settings/devices/name_input',
  currentInput: '/menu_native/dynamic/tv_settings/devices/current_input',
  volume: '/menu_native/dynamic/tv_settings/audio/volume',
  mute: '/menu_native/dynamic/tv_settings/audio/mute'
};

class VizioError extends Error {
  constructor(message, { code, detail, status } = {}) {
    super(message);
    this.name = 'VizioError';
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
  /** True for network-level failures where the TV may simply have moved IP. */
  get isConnectionError() {
    return ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ENOTFOUND', 'EVIZIOTIMEOUT'].includes(this.code);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

class VizioClient {
  constructor({ host, port = 7345, authToken, deviceId, deviceName = 'Node-RED', timeout = 5000 } = {}) {
    this.host = host;
    this.port = Number(port) || 7345;
    this.authToken = authToken;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.timeout = timeout;
    // The TV uses a self-signed certificate. Scoped to this agent only.
    this.agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });
  }

  request(method, path, body, { auth = true } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const headers = { 'Content-Type': 'application/json' };
      if (data !== undefined) headers['Content-Length'] = Buffer.byteLength(data);
      if (auth && this.authToken) headers.AUTH = this.authToken;
      const req = https.request(
        { hostname: this.host, port: this.port, path, method, headers, agent: this.agent, timeout: this.timeout },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            let json;
            try { json = JSON.parse(raw); } catch (e) {
              return reject(new VizioError(`Invalid response from TV (HTTP ${res.statusCode})`, { status: res.statusCode, detail: raw.slice(0, 200) }));
            }
            const result = json && json.STATUS && String(json.STATUS.RESULT || '').toLowerCase();
            if (result !== 'success') {
              const detail = json && json.STATUS && json.STATUS.DETAIL;
              return reject(new VizioError(`TV returned ${(json.STATUS && json.STATUS.RESULT) || 'error'}${detail ? ': ' + detail : ''}`, {
                code: json.STATUS && json.STATUS.RESULT, detail, status: res.statusCode
              }));
            }
            resolve(json);
          });
        }
      );
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'EVIZIOTIMEOUT' })));
      req.on('error', (err) => reject(err instanceof VizioError ? err : new VizioError(`Cannot reach TV at ${this.host}:${this.port}: ${err.message}`, { code: err.code })));
      if (data !== undefined) req.write(data);
      req.end();
    });
  }

  // ---- pairing -------------------------------------------------------
  async pairStart() {
    const r = await this.request('PUT', PATHS.pairStart, { DEVICE_ID: this.deviceId, DEVICE_NAME: this.deviceName }, { auth: false });
    return { pairingReqToken: r.ITEM.PAIRING_REQ_TOKEN, challengeType: r.ITEM.CHALLENGE_TYPE };
  }
  async pairFinish({ pin, pairingReqToken, challengeType = 1 }) {
    const r = await this.request('PUT', PATHS.pairFinish, {
      DEVICE_ID: this.deviceId, CHALLENGE_TYPE: challengeType, RESPONSE_VALUE: String(pin), PAIRING_REQ_TOKEN: pairingReqToken
    }, { auth: false });
    return { authToken: r.ITEM.AUTH_TOKEN };
  }
  async pairCancel(challengeType = 1) {
    return this.request('PUT', PATHS.pairCancel, { DEVICE_ID: this.deviceId, CHALLENGE_TYPE: challengeType, RESPONSE_VALUE: '1111' }, { auth: false });
  }

  // ---- keys ----------------------------------------------------------
  /** keys: array of key names (see keys.js) or [codeset, code] pairs. */
  keypress(keys) {
    const KEYLIST = keys.map((k) => {
      const [CODESET, CODE] = Array.isArray(k) ? k : KEYS[k];
      return { CODESET, CODE, ACTION: 'KEYPRESS' };
    });
    return this.request('PUT', PATHS.keyPress, { KEYLIST });
  }
  /** Press one key `count` times, pausing between presses (TVs drop rapid repeats). */
  async repeatKey(key, count, delayMs = 100) {
    for (let i = 0; i < count; i++) {
      if (i) await sleep(delayMs);
      await this.keypress([key]);
    }
  }

  // ---- state ---------------------------------------------------------
  async getPower() {
    const r = await this.request('GET', PATHS.power);
    return Number(r.ITEMS[0].VALUE) === 1;
  }
  async getVolume() {
    const r = await this.request('GET', PATHS.volume);
    return { value: Number(r.ITEMS[0].VALUE), hashval: r.ITEMS[0].HASHVAL };
  }
  async setVolume(level) {
    const { hashval } = await this.getVolume();
    const value = clamp(Math.round(Number(level)), 0, 100);
    if (Number.isNaN(value)) throw new VizioError('Volume must be a number');
    await this.request('PUT', PATHS.volume, { REQUEST: 'MODIFY', VALUE: value, HASHVAL: hashval });
    return value;
  }
  async getMute() {
    const r = await this.request('GET', PATHS.mute);
    return String(r.ITEMS[0].VALUE).toLowerCase() === 'on';
  }
  /** [{ name: 'HDMI-2', cname: 'hdmi2', label: 'Nintendo Switch' }] */
  async getInputs() {
    const r = await this.request('GET', PATHS.inputs);
    return r.ITEMS.map((i) => ({ name: i.NAME, cname: i.CNAME, label: i.VALUE && i.VALUE.NAME ? i.VALUE.NAME : i.NAME }));
  }
  async getCurrentInput() {
    const r = await this.request('GET', PATHS.currentInput);
    return { name: r.ITEMS[0].VALUE, hashval: r.ITEMS[0].HASHVAL };
  }
  /** Accepts a name (HDMI-1), cname (hdmi1), user label ("Nintendo Switch") or "smartcast"/"cast". */
  async setInput(wanted) {
    const norm = (s) => String(s).trim().toLowerCase().replace(/[\s_]+/g, '-');
    let w = norm(wanted);
    if (w === 'smartcast' || w === 'smart-cast') w = 'cast';
    const inputs = await this.getInputs();
    const match = inputs.find((i) => [i.name, i.cname, i.label].some((x) => norm(x) === w || norm(x).replace(/-/g, '') === w.replace(/-/g, '')));
    if (!match) throw new VizioError(`Unknown input "${wanted}". Available: ${inputs.map((i) => i.name + (i.label !== i.name ? ` (${i.label})` : '')).join(', ')}`);
    const { hashval } = await this.getCurrentInput();
    await this.request('PUT', PATHS.currentInput, { REQUEST: 'MODIFY', VALUE: match.name, HASHVAL: hashval });
    return match.name;
  }
}

module.exports = { VizioClient, VizioError, PATHS, sleep };

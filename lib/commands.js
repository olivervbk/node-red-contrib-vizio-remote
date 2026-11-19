'use strict';
const { VizioError } = require('./api');

// action -> key name (simple one-key actions)
const KEY_ACTIONS = {
  power_on: 'POW_ON', power_off: 'POW_OFF', power_toggle: 'POW_TOGGLE',
  mute_on: 'MUTE_ON', mute_off: 'MUTE_OFF', mute_toggle: 'MUTE_TOGGLE',
  play: 'PLAY', pause: 'PAUSE', seek_forward: 'SEEK_FWD', seek_back: 'SEEK_BACK',
  channel_up: 'CH_UP', channel_down: 'CH_DOWN', channel_prev: 'CH_PREV',
  up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', ok: 'OK', back: 'BACK',
  exit: 'EXIT', menu: 'MENU', home: 'HOME', info: 'INFO', closed_captions: 'CC_TOGGLE',
  picture_mode: 'PIC_MODE', picture_size: 'PIC_SIZE', input_next: 'INPUT_NEXT'
};
const ALL_ACTIONS = [...Object.keys(KEY_ACTIONS), 'volume_up', 'volume_down', 'volume_set', 'input_set', 'smartcast', 'key'];

const normAction = (a) => String(a || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Merge node config with msg.payload overrides. */
function resolveCommand(config, payload) {
  const cmd = { ...config };
  if (typeof payload === 'string' && payload.trim()) cmd.action = payload;
  else if (payload && typeof payload === 'object') {
    for (const k of ['action', 'amount', 'input', 'volume', 'codeset', 'code']) if (payload[k] !== undefined && payload[k] !== '') cmd[k] = payload[k];
  } else if (typeof payload === 'number' && normAction(cmd.action).startsWith('volume')) cmd.amount = payload;
  cmd.action = normAction(cmd.action);
  return cmd;
}

async function execute(client, cmd, { repeatDelay = 100 } = {}) {
  const action = cmd.action;
  if (KEY_ACTIONS[action]) { await client.keypress([KEY_ACTIONS[action]]); return { action }; }
  switch (action) {
    case 'volume_up':
    case 'volume_down': {
      const amount = Math.min(100, Math.max(1, Math.round(Number(cmd.amount ?? 1)) || 1));
      await client.repeatKey(action === 'volume_up' ? 'VOL_UP' : 'VOL_DOWN', amount, repeatDelay);
      return { action, amount };
    }
    case 'volume_set': {
      const raw = cmd.volume ?? cmd.amount;
      if (raw === undefined || raw === '' || Number.isNaN(Number(raw))) throw new VizioError('volume_set needs a volume (0-100)');
      return { action, volume: await client.setVolume(raw) };
    }
    case 'input_set': {
      if (!cmd.input) throw new VizioError('input_set needs an input name (e.g. HDMI-1, SmartCast)');
      return { action, input: await client.setInput(cmd.input) };
    }
    case 'smartcast': await client.keypress(['SMARTCAST']); return { action };
    case 'key': {
      const codeset = Number(cmd.codeset), code = Number(cmd.code);
      if (!Number.isInteger(codeset) || !Number.isInteger(code)) throw new VizioError('key needs numeric codeset and code');
      await client.keypress([[codeset, code]]);
      return { action, codeset, code };
    }
    default:
      throw new VizioError(`Unknown action "${cmd.action}". Valid: ${ALL_ACTIONS.join(', ')}`);
  }
}

async function readStatus(client) {
  const status = { power: await client.getPower() };
  if (!status.power) return status; // settings are unavailable while the TV is off
  const attempt = async (fn) => { try { return await fn(); } catch (e) { return undefined; } };
  const [input, volume, muted, inputs] = await Promise.all([
    attempt(() => client.getCurrentInput()), attempt(() => client.getVolume()), attempt(() => client.getMute()), attempt(() => client.getInputs())
  ]);
  if (input) {
    status.input = input.name;
    const m = inputs && inputs.find((i) => i.name === input.name);
    status.inputLabel = m ? m.label : input.name;
  }
  if (volume) status.volume = volume.value;
  if (muted !== undefined) status.muted = muted;
  return status;
}

module.exports = { KEY_ACTIONS, ALL_ACTIONS, resolveCommand, execute, readStatus, normAction };

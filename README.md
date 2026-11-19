# node-red-contrib-vizio-remote

Node-RED nodes to pair with and control **Vizio SmartCast TVs** over your local network, using the TV's
built-in HTTPS API (port 7345). No cloud, no extra dependencies besides mDNS discovery.

> Not affiliated with, endorsed by or sponsored by VIZIO, Inc. "VIZIO" and "SmartCast" are trademarks of their owners.

## Nodes

| Node | Purpose |
| --- | --- |
| **vizio-tv** (config) | Host, port and credentials for one TV. Has **Discover** and **Pair** buttons. |
| **vizio-command** | Power, volume, mute, playback, inputs, navigation, raw keys. |
| **vizio-status** | Reads power, current input, volume and mute state. |

## Install

Palette Manager → search `node-red-contrib-vizio-remote`, or:

```bash
cd ~/.node-red && npm install node-red-contrib-vizio-remote
```

## Pairing a TV

1. Add a **vizio-command** node and click the pencil next to *TV* to create a TV config.
2. Click **Discover TVs** (or type the IP address by hand).
3. Click **Pair with TV**. A PIN appears on the TV screen.
4. Type the PIN and **Submit**. The auth token is filled in and stored as an encrypted Node-RED credential.
5. **Done**, then **Deploy**.

Give the TV a fixed IP (DHCP reservation) for reliability. If the TV was discovered via mDNS and later changes address,
the nodes search for it again and retry once, logging a warning.

## vizio-command

Pick an action in the editor, or override it per message with `msg.payload`:

```js
"volume_up"                                    // string = action
{ "action": "volume_up", "amount": 5 }         // five presses
{ "action": "volume_set", "volume": 25 }       // absolute, 0–100
{ "action": "input_set", "input": "HDMI-2" }   // also "SmartCast", or your own label e.g. "Game Console"
{ "action": "key", "codeset": 5, "code": 1 }   // raw key
```

Actions: `power_on` `power_off` `power_toggle` · `volume_up` `volume_down` `volume_set` `mute_on` `mute_off` `mute_toggle` ·
`play` `pause` `seek_forward` `seek_back` · `input_set` `input_next` `smartcast` · `channel_up` `channel_down` `channel_prev` ·
`up` `down` `left` `right` `ok` `back` `exit` `menu` `home` `info` · `closed_captions` `picture_mode` `picture_size` · `key`.

Output: `msg.payload = { ok: true, action, … }`. Failures are raised as node errors (use a Catch node).

## vizio-status

`msg.payload = { power: true, input: "HDMI-3", inputLabel: "HTPC", volume: 30, muted: false }`.
When the TV is off, only `{ power: false }`.

## Limitations

- **No "stop" key**: the SmartCast API only offers play and pause.
- **Power on** works only if the TV keeps its network connection while off (enable *Quick Start* / disable *Eco* mode in the TV's settings).
- **Discovery** uses multicast DNS. It does not cross Docker bridge networks or VLANs; use host networking or type the IP.
- Volume ×N sends N key presses ~100 ms apart because TVs can drop rapid repeats.
- The TV's HTTPS certificate is self-signed; certificate checking is disabled for connections to the TV only (never globally).
- Older firmware may use port 9000 instead of 7345.
- Developed and tested against a Vizio E-series (E55-E1) TV. Reports for other models are welcome.

## Security note

The auth token grants full remote control of the TV on your LAN. It is stored in Node-RED's encrypted credentials file;
set a `credentialSecret` in `settings.js` and do not commit `flows_cred.json`. The pairing endpoints in the editor
require the Node-RED admin permission `vizio-tv.write`.

## Development

```bash
npm install
npm test     # runs against a local fake TV, no hardware needed
```

Key codes and endpoints were cross-checked against [pyvizio](https://github.com/vkorn/pyvizio).

## License

MIT

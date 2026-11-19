'use strict';

/**
 * Browse the LAN for Vizio SmartCast TVs (mDNS service _viziocast._tcp).
 * `factory` is injectable for tests. Note: multicast is blocked by Docker bridge networks.
 */
function discover({ timeout = 3000, factory } = {}) {
  const make = factory || (() => new (require('bonjour-service').Bonjour)());
  return new Promise((resolve) => {
    const bonjour = make();
    const found = new Map();
    const browser = bonjour.find({ type: 'viziocast', protocol: 'tcp' }, (svc) => {
      const txt = svc.txt || {};
      const addr = (svc.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || svc.referer && svc.referer.address || svc.host;
      found.set(txt.did || svc.fqdn || svc.name, {
        name: txt.name || svc.name,
        host: addr,
        port: Number(txt.hsp) || svc.port || 7345,
        model: txt.mdl,
        tvId: txt.did
      });
    });
    setTimeout(() => {
      try { browser.stop(); bonjour.destroy(); } catch (e) { /* ignore */ }
      resolve([...found.values()]);
    }, timeout);
  });
}

module.exports = { discover };

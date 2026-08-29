'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'nexus.plugin.json');
const key = process.env.NEXUS_PLUGIN_SIGNING_KEY_PEM;
if (!key) throw new Error('NEXUS_PLUGIN_SIGNING_KEY_PEM is required; private signing keys are never stored in this repository.');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const unsigned = { ...manifest };
delete unsigned.signature;
const payload = Buffer.from(JSON.stringify(unsigned, Object.keys(unsigned).sort()), 'utf8');
const signature = crypto.sign(null, payload, key).toString('base64');
const signed = { ...unsigned, signature };
const out = path.join(root, 'dist', 'signed');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'nexus.plugin.json'), `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
fs.copyFileSync(path.join(root, 'index.js'), path.join(out, 'index.js'));
console.log('[The Crucible Nexus plugin] signed release staging created without modifying source manifest.');

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'nexus.plugin.json'), 'utf8'));
const included = [
  'nexus.plugin.json',
  'index.js',
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
  'HOST-CONTRACT.md',
  'sbom.spdx.json'
].sort();
const files = included.map((relative) => ({
  path: relative,
  data: fs.readFileSync(path.join(root, relative)).toString('base64')
}));
const digest = crypto.createHash('sha256');
for (const file of files) {
  digest.update(file.path); digest.update('\0'); digest.update(Buffer.from(file.data, 'base64')); digest.update('\0');
}
const payload = {
  format: 'nexus-plugin-package',
  version: 1,
  pluginId: manifest.id,
  digest: digest.digest('hex'),
  files
};
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `${manifest.id}-${manifest.version}.nexusplugin`);
const serialized = `${JSON.stringify(payload)}\n`;
fs.writeFileSync(output, serialized, 'utf8');
console.log(`[The Crucible Nexus plugin] package written: ${output}`);
console.log(`[The Crucible Nexus plugin] package sha256:${crypto.createHash('sha256').update(serialized).digest('hex')}`);

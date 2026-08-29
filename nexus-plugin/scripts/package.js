'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const outputDir = path.resolve(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'nexus.plugin.json'), 'utf8'));
const included = ['nexus.plugin.json','index.js','README.md','CHANGELOG.md','SECURITY.md','HOST-CONTRACT.md'];
const files = included.sort().map((relative) => ({
  path: relative,
  data: fs.readFileSync(path.join(root, relative)).toString('base64')
}));
const contentDigest = crypto.createHash('sha256');
for (const file of files) { contentDigest.update(file.path); contentDigest.update('\0'); contentDigest.update(Buffer.from(file.data, 'base64')); contentDigest.update('\0'); }
const payload = {
  format: 'nexus-plugin-source-package',
  version: 1,
  pluginId: manifest.id,
  pluginVersion: manifest.version,
  digest: contentDigest.digest('hex'),
  files
};
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `${manifest.id}-${manifest.version}.nexusplugin.json`);
fs.writeFileSync(output, serialized, 'utf8');
console.log(`[The Crucible Nexus plugin] package written: ${output}`);
console.log(`[The Crucible Nexus plugin] package sha256:${crypto.createHash('sha256').update(serialized).digest('hex')}`);

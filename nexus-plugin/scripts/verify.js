'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'nexus.plugin.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const entry = fs.readFileSync(path.join(root, manifest.entry), 'utf8');

function fail(message) {
  console.error(`[The Crucible Nexus plugin] ${message}`);
  process.exitCode = 1;
}

if (manifest.id !== 'the-crucible') fail('manifest id must be the-crucible');
if (manifest.version !== '0.0.1' || pkg.version !== manifest.version) fail('package and manifest versions must both be 0.0.1');
if (manifest.apiVersion !== 1) fail('apiVersion must be 1');
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version)) fail('version must be semantic x.y.z');
if (manifest.entry !== 'index.js') fail('entry must remain the reviewed self-contained index.js');
if (!entry.includes('register({')) fail('entry must register with Nexus');
if (/\brequire\s*\(/.test(entry)) fail('runtime entry must not depend on Node require');
if (/\bprocess\s*\./.test(entry)) fail('runtime entry must not use process');
if (/\bchild_process\b|\bexec(?:File|Sync)?\s*\(|\bspawn(?:Sync)?\s*\(/.test(entry)) fail('runtime entry must not execute processes');
const capabilities = [...manifest.capabilities].sort();
const expected = ['account:private','telemetry:emit','ui:slot','workspace:read','workspace:write'].sort();
if (JSON.stringify(capabilities) !== JSON.stringify(expected)) fail(`unexpected capability set: ${capabilities.join(', ')}`);
if ((manifest.slots || []).some((slot) => !['project-actions','inspector-panel','command-palette'].includes(slot))) fail('manifest declares an unreviewed UI slot');

const inventory = ['nexus.plugin.json','index.js','README.md','CHANGELOG.md','SECURITY.md','HOST-CONTRACT.md','package.json'];
for (const file of inventory) if (!fs.existsSync(path.join(root, file))) fail(`required package file missing: ${file}`);

const digest = crypto.createHash('sha256');
for (const file of inventory.sort()) {
  digest.update(file); digest.update('\0'); digest.update(fs.readFileSync(path.join(root, file))); digest.update('\0');
}
if (!process.exitCode) console.log(`[The Crucible Nexus plugin] v${manifest.version} verified; source digest sha256:${digest.digest('hex')}`);

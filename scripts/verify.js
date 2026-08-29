'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'nexus.plugin.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const entry = fs.readFileSync(path.join(root, manifest.entry), 'utf8');

function fail(message) {
  console.error(`[The Crucible Nexus plugin] ${message}`);
  process.exitCode = 1;
}

if (manifest.id !== 'the-crucible') fail('manifest id must be the-crucible');
if (manifest.version !== '0.0.1' || pkg.version !== manifest.version) fail('package and manifest versions must match v0.0.1');
if (manifest.apiVersion !== 1) fail('apiVersion must be 1');
if (manifest.entry !== 'index.js') fail('entry must be index.js');
const expectedCapabilities = ['telemetry:emit','ui:slot','workspace:read','workspace:write'];
if (JSON.stringify([...manifest.capabilities].sort()) !== JSON.stringify(expectedCapabilities)) fail(`unexpected capability set: ${manifest.capabilities.join(', ')}`);
if (/\brequire\s*\(/.test(entry)) fail('runtime entry must not use require');
if (/\bprocess\s*\./.test(entry)) fail('runtime entry must not use process');
if (/child_process|\bexec(?:File|Sync)?\s*\(|\bspawn(?:Sync)?\s*\(/.test(entry)) fail('runtime entry must not execute processes');
if (!entry.includes("const CANONICAL_BRANCH = 'main'")) fail('canonical shared content must reference the default main branch');
if (!entry.includes('CRUCIBLE-REFERENCES.json')) fail('Auto Inject must use the reference manifest');
if (entry.includes('BOOTSTRAP_FILES')) fail('shared governance must not be bundled as bootstrap copies');
if (!process.exitCode) console.log('[The Crucible Nexus plugin] static verification passed.');

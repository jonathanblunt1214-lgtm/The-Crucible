const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditCollisions } = require('../src/collisions');

test('skips safely outside a GitHub pull-request context', async () => {
  assert.deepEqual(await auditCollisions({}, async () => { throw new Error('not called'); }), { skipped:true, findings:[] });
});

test('reports only files shared with another open pull request', async () => {
  const eventPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-collision-')), 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ pull_request:{ number:7 } }));
  const responses = new Map([
    ['/pulls/7/files', [{ filename:'src/app.js' }, { filename:'README.md' }]],
    ['/pulls?state=open', [{ number:7, title:'Current' }, { number:9, title:'Other work' }]],
    ['/pulls/9/files', [{ filename:'src/app.js' }, { filename:'docs/guide.md' }]],
  ]);
  const fetchImpl = async (url) => {
    const key = [...responses.keys()].find((candidate) => url.includes(candidate));
    return { ok:true, json:async () => responses.get(key) || [] };
  };
  const result = await auditCollisions({ GITHUB_REPOSITORY:'owner/repo', GITHUB_TOKEN:'token', GITHUB_EVENT_PATH:eventPath }, fetchImpl);
  assert.deepEqual(result.findings, [{ number:9, title:'Other work', paths:['src/app.js'] }]);
});

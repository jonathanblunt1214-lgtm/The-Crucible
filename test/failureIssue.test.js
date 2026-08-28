const test = require('node:test');
const assert = require('node:assert/strict');
const { ISSUE_MARKER, buildFailureNotice, publishFailureIssue } = require('../src/failureIssue');

const environment = {
  GITHUB_REPOSITORY:'example/project',
  GITHUB_RUN_ID:'123',
  GITHUB_RUN_ATTEMPT:'2',
  GITHUB_SHA:'0123456789abcdef0123456789abcdef01234567',
  GITHUB_SERVER_URL:'https://github.com',
  GITHUB_API_URL:'https://api.github.com',
  GITHUB_TOKEN:'token-for-test',
};

test('builds a bounded failure notice with the run and repair summary', () => {
  const notice = buildFailureNotice({ results:[{ action:'security', status:'failed', error:'unsafe content', suggestedFix:'remove it' }] }, environment);
  assert.match(notice, new RegExp(ISSUE_MARKER));
  assert.match(notice, /actions\/runs\/123/);
  assert.match(notice, /the-crucible-report-123-2/);
  assert.match(notice, /\*\*security\*\*: unsafe content/);
  assert.match(notice, /\*\*Repair:\*\* remove it/);
  assert.match(notice, /updated in place/);
});

test('creates one issue when no open Crucible failure issue exists', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return { ok:true, json:async () => [] };
    return { ok:true, json:async () => ({ number:17 }) };
  };
  const result = await publishFailureIssue(environment, fetchImpl);
  assert.deepEqual(result, { action:'created', number:17 });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/issues$/);
  assert.equal(JSON.parse(calls[1].options.body).title, '[The Crucible] Gate failure');
});

test('updates the existing open failure issue instead of adding per-run comments', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return { ok:true, json:async () => [{ number:9, title:'[The Crucible] Gate failure', body:ISSUE_MARKER }] };
    return { ok:true, json:async () => ({ number:9 }) };
  };
  const result = await publishFailureIssue(environment, fetchImpl);
  assert.deepEqual(result, { action:'updated', number:9 });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/issues\/9$/);
  assert.equal(calls[1].options.method, 'PATCH');
  assert.doesNotMatch(calls[1].url, /\/comments$/);
});

test('refuses unsafe repository identifiers before any API call', async () => {
  let called = false;
  await assert.rejects(() => publishFailureIssue({ ...environment, GITHUB_REPOSITORY:'example/project?x=1' }, async () => { called = true; }), /unsafe repository identifier/);
  assert.equal(called, false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeReport, safeMessage, suggestedFix } = require('../src/report');

test('writes and appends a project-specific report only when requested', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-report-'));
  const oldPath = process.env.CRUCIBLE_REPORT_PATH;
  process.env.CRUCIBLE_REPORT_PATH = path.join(root, 'saved', 'report.json');
  try {
    writeReport({ root, config:{ project:{ name:'Example' } }, action:'validate', status:'passed' });
    writeReport({ root, config:{ project:{ name:'Example' } }, action:'security', status:'failed', error:new Error('unsafe\nsecret output') });
    const report = JSON.parse(fs.readFileSync(process.env.CRUCIBLE_REPORT_PATH, 'utf8'));
    assert.equal(report.project.name, 'Example');
    assert.deepEqual(report.results.map(({ action, status }) => ({ action, status })), [
      { action:'validate', status:'passed' }, { action:'security', status:'failed' },
    ]);
    assert.equal(report.results[1].error, 'unsafe');
    assert.match(report.results[1].suggestedFix, /reported file and line/i);
  } finally {
    if (oldPath === undefined) delete process.env.CRUCIBLE_REPORT_PATH; else process.env.CRUCIBLE_REPORT_PATH = oldPath;
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('records which files were flagged and quarantined, not just the truncated error text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-report-'));
  const oldPath = process.env.CRUCIBLE_REPORT_PATH;
  process.env.CRUCIBLE_REPORT_PATH = path.join(root, 'report.json');
  try {
    const error = new Error('Security Gate detected suspicious content:\n- reverse-shell payload: app.js:12');
    error.findings = [{ type:'reverse-shell payload', path:'app.js', line:12 }];
    error.quarantined = ['app.js'];
    writeReport({ root, config:{ project:{ name:'Example' } }, action:'security', status:'failed', error });
    const report = JSON.parse(fs.readFileSync(process.env.CRUCIBLE_REPORT_PATH, 'utf8'));
    assert.deepEqual(report.results[0].findings, [{ type:'reverse-shell payload', path:'app.js', line:12 }]);
    assert.deepEqual(report.results[0].quarantined, ['app.js']);
  } finally {
    if (oldPath === undefined) delete process.env.CRUCIBLE_REPORT_PATH; else process.env.CRUCIBLE_REPORT_PATH = oldPath;
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('redacts common credentials from report errors', () => {
  const token = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_');
  assert.equal(safeMessage(new Error(`token ${token}`)), 'token [REDACTED]');
});

test('provides bounded action-specific remediation without claiming a guaranteed fix', () => {
  assert.match(suggestedFix('privacy'), /rotate any exposed credential/i);
  assert.match(suggestedFix('unknown-action'), /review the failed action/i);
  assert.doesNotMatch(suggestedFix('security'), /guarantee|every possible/i);
});

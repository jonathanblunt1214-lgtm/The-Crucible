const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('reusable workflow is read-only and uses the exact caller-supplied core ref', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'the-crucible.yml'), 'utf8');
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /ref: \$\{\{ inputs\.core_ref \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /contents: write|git push/);
  assert.match(workflow, /CRUCIBLE_REPORT_PATH: \$\{\{ runner\.temp \}\}\/the-crucible-report\.json/);
  assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /Run Security Gate[\s\S]*cli\.js security[\s\S]*Run verification and bounded workload/);
  assert.match(workflow, /overlapping open pull requests[\s\S]*cli\.js collisions/);
  assert.match(workflow, /Pre-check changed commit and code[\s\S]*cli\.js precheck/);
});

test('caller template schedules daily clutter and weekly maintenance', () => {
  const workflow = fs.readFileSync(path.join(root, 'templates', 'caller-workflow.yml'), 'utf8');
  assert.match(workflow, /cron: '17 3 \* \* \*'/);
  assert.match(workflow, /cron: '47 4 \* \* 0'/);
  assert.match(workflow, /weekly_maintenance:.*47 4 \* \* 0/);
  assert.equal((workflow.match(/REPLACE_WITH_EXACT_COMMIT_SHA/g) || []).length, 2);
});

test('documentation explicitly covers behavior, limits, and non-goals', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const statement of ['Exactly what it does', 'Every 24 hours', 'Weekly', 'does not rebase', 'does not silently delete clutter', 'What it deliberately does not do']) assert.match(readme, new RegExp(statement, 'i'));
});

test('engine changes test across supported operating systems before adoption', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'self-test.yml'), 'utf8');
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(workflow, /node: \[20, 22, 24\]/);
  assert.match(workflow, /npm test[\s\S]*npm run validate[\s\S]*npm run audit:clutter[\s\S]*npm run audit:security[\s\S]*npm run precheck[\s\S]*npm run run/);
});

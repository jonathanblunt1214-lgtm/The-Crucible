const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PROVIDER_IDS, CREDENTIAL_ENV_NAMES, describeProvider, credentialPresent, credentialFor,
  endpointFor, modelFor, redact, findCredentialLeaks, assertNoCredentialsPersisted,
} = require('../src/aiProviderRegistry');

const FAKE = 'sk-testtesttesttesttest0123456789';
const ENV = { OPENAI_API_KEY: FAKE, ANTHROPIC_API_KEY: '', PERPLEXITY_API_KEY: '', NVIDIA_NIM_API_KEY: '' };

test('exactly the four governed providers are registered', () => {
  assert.deepEqual([...PROVIDER_IDS].sort(), ['anthropic', 'nvidia-nim', 'openai', 'perplexity']);
  assert.deepEqual([...CREDENTIAL_ENV_NAMES].sort(), ['ANTHROPIC_API_KEY', 'NVIDIA_NIM_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY']);
});

test('an unregistered provider is refused rather than silently reached', () => {
  assert.throws(() => describeProvider('some-other-vendor'), (error) => error.crucibleCode === 'CRU-0033');
});

test('credentials come from the environment and a missing one is an explicit failure', () => {
  assert.equal(credentialPresent('openai', ENV), true);
  assert.equal(credentialPresent('anthropic', ENV), false);
  assert.equal(credentialFor('openai', ENV), FAKE);
  assert.throws(
    () => credentialFor('anthropic', ENV),
    (error) => error.crucibleCode === 'CRU-0033' && /ANTHROPIC_API_KEY/.test(error.message) && /never place it in a source file/.test(error.message),
  );
});

test('endpoint and model are overridable by environment without editing source', () => {
  assert.equal(endpointFor('openai', ENV), 'https://api.openai.com/v1/chat/completions');
  assert.equal(endpointFor('openai', { ...ENV, OPENAI_BASE_URL: 'https://gateway.internal/v1/chat' }), 'https://gateway.internal/v1/chat');
  assert.equal(modelFor('openai', ENV), null);
  assert.equal(modelFor('openai', { ...ENV, OPENAI_MODEL: 'pinned-model' }), 'pinned-model');
});

test('an API root is completed with the provider path, and an explicit endpoint is left alone', () => {
  // The AI Collaboration project configures every provider with the API *root* and appends the
  // path itself. Reusing one already-provisioned base URL across both projects is the point of
  // sharing a free credential, so the root form has to reach the right path here too.
  assert.equal(
    endpointFor('nvidia-nim', { ...ENV, NVIDIA_NIM_BASE_URL: 'https://integrate.api.nvidia.com/v1' }),
    'https://integrate.api.nvidia.com/v1/chat/completions',
  );
  assert.equal(
    endpointFor('nvidia-nim', { ...ENV, NVIDIA_NIM_BASE_URL: 'https://integrate.api.nvidia.com/v1/' }),
    'https://integrate.api.nvidia.com/v1/chat/completions',
  );
  // Idempotent: the complete form this registry has always used must not gain a second path.
  assert.equal(
    endpointFor('nvidia-nim', { ...ENV, NVIDIA_NIM_BASE_URL: 'https://integrate.api.nvidia.com/v1/chat/completions' }),
    'https://integrate.api.nvidia.com/v1/chat/completions',
  );
  // Per dialect, not one global path: Anthropic's Messages API is not chat/completions.
  assert.equal(
    endpointFor('anthropic', { ...ENV, ANTHROPIC_BASE_URL: 'https://api.anthropic.com/v1' }),
    'https://api.anthropic.com/v1/messages',
  );
  // An operator who pointed at a gateway path meant that path; rewriting it would break them.
  assert.equal(endpointFor('openai', { ...ENV, OPENAI_BASE_URL: 'https://gateway.internal/v1/chat' }), 'https://gateway.internal/v1/chat');
});

test('a live credential value is redacted out of any text', () => {
  assert.equal(redact(`key=${FAKE} rest`, ENV), 'key=[redacted:OPENAI_API_KEY] rest');
  assert.equal(redact('nothing secret here', ENV), 'nothing secret here');
});

test('a credential in a governance artifact is detected by value and by shape', () => {
  const byValue = findCredentialLeaks(`{"note":"${FAKE}"}`, { env: ENV, label: 'AI-HANDOFF.json' });
  assert.ok(byValue.length >= 1);
  assert.match(byValue[0].detail, /AI-HANDOFF\.json/);
  // Detected even when the key belongs to a different environment than the one auditing.
  const otherEnvKey = findCredentialLeaks('token: sk-ant-aaaaaaaaaaaaaaaaaaaaaa', { env: {}, label: 'DEVLOG.md' });
  assert.ok(otherEnvKey.some((item) => /Anthropic-style key/.test(item.detail)));
  assert.deepEqual(findCredentialLeaks('a perfectly ordinary sentence', { env: ENV }), []);
});

test('asserting a clean artifact throws with the credential failure code', () => {
  assert.throws(
    () => assertNoCredentialsPersisted(`prompt containing ${FAKE}`, { env: ENV, label: 'prompt' }),
    (error) => error.crucibleCode === 'CRU-0033',
  );
  assert.deepEqual(assertNoCredentialsPersisted('clean prompt', { env: ENV }), { clean: true });
});

test('the repository\'s own governance artifacts carry no credentials', () => {
  const root = path.join(__dirname, '..');
  for (const relative of ['AI-HANDOFF.json', 'AI-CONFLICTS.json', 'DEVLOG.md', 'templates/ai-handoff.example.json', 'templates/ai-conflicts.example.json']) {
    const target = path.join(root, relative);
    if (!fs.existsSync(target)) continue;
    assert.deepEqual(findCredentialLeaks(fs.readFileSync(target, 'utf8'), { env: {}, label: relative }), [], `${relative} must not contain a credential`);
  }
});

// The owner pays for this engine and drew the line explicitly: The Crucible consults the free
// part of the council only, while the whole council including paid providers belongs to the
// owner's own client. That boundary is money, so it is recorded in the registry and enforced in
// the CLI rather than left to which secret a workflow happens to export - otherwise "Crucible is
// free" stays true only until one paid key reaches one job.
test('the registry separates the free council from the paid one, and consult calls only the free part', async () => {
  const { FREE_PROVIDER_IDS, PAID_PROVIDER_IDS, PROVIDERS } = require('../src/aiProviderRegistry');
  assert.deepEqual([...FREE_PROVIDER_IDS], ['nvidia-nim']);
  assert.deepEqual([...PAID_PROVIDER_IDS].sort(), ['anthropic', 'openai', 'perplexity']);
  // Every governed provider is one or the other, so a provider added later cannot default to free.
  for (const id of PROVIDER_IDS) assert.ok(['free', 'paid'].includes(PROVIDERS[id].billing), `${id} declares no billing tier`);
  assert.equal(FREE_PROVIDER_IDS.length + PAID_PROVIDER_IDS.length, PROVIDER_IDS.length);
  // Perplexity is paid on purpose: a Perplexity Pro subscription does not cover the API billing
  // this adapter uses, and assuming it did already cost this repository a blocked gate.
  assert.equal(PROVIDERS.perplexity.billing, 'paid');

  // The property that protects the owner's money: a paid credential in the environment must never
  // produce a paid call. Run as a real process, because the guard lives in the CLI path a
  // workflow invokes, and asserting it on an import would not exercise that path.
  const { execFile } = require('node:child_process');
  const run = (env) => new Promise((resolve) => {
    execFile(process.execPath, ['src/coordinationCli.js', 'consult', '--task', 't', '--prompt', 'p'],
      { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env }, timeout: 60000 },
      (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }));
  });

  const paidOnly = await run({
    OPENAI_API_KEY: 'test-key-not-used', OPENAI_MODEL: 'gpt-4o',
    ANTHROPIC_API_KEY: '', PERPLEXITY_API_KEY: '', NVIDIA_NIM_API_KEY: '',
  });
  assert.notEqual(paidOnly.code, 0, 'a paid-only environment must refuse rather than spend');
  assert.match(paidOnly.stderr, /OpenAI is configured but was not consulted/, 'the exclusion is stated, not silent');
  assert.match(paidOnly.stderr, /CRU-0034/);
  assert.match(paidOnly.stderr, /free part of the council only|No free provider is configured/);
  // Nothing was sent: no deliberation block reached stdout.
  assert.equal(paidOnly.stdout.trim(), '', 'a refused consult produces no deliberation');
});

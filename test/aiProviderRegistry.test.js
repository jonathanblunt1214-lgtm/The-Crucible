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

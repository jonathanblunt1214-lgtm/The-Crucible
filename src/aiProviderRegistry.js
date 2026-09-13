// The four providers, and the one place their credentials are allowed to exist.
//
// A credential belongs in the environment - a GitHub secret, a local export - and nowhere else.
// The governance artifacts this repository commits (AI-HANDOFF.json, AI-CONFLICTS.json,
// DEVLOG.md) are permanent, public to anyone with the repository, and are exactly the files an
// AI is most likely to paste a working prompt into. So this module does two things: it names the
// environment variable each provider reads, and it provides the check that refuses to let any of
// those values appear in a committed artifact or a log line.
//
// The adapters are deliberately thin and replaceable. They describe how to reach a provider;
// they do not encode which provider is trusted, because that is a governance question decided
// elsewhere and never by the adapter that wants to be called.
const { crucibleError } = require('./failureCodes');

// Endpoint and model are overridable by environment so a deployment can pin a version or point
// at a compatible gateway without editing committed source.
const PROVIDERS = Object.freeze({
  openai: Object.freeze({
    id: 'openai',
    label: 'OpenAI',
    credentialEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    endpointEnv: 'OPENAI_BASE_URL',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
  }),
  anthropic: Object.freeze({
    id: 'anthropic',
    label: 'Anthropic Claude',
    credentialEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    endpointEnv: 'ANTHROPIC_BASE_URL',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
  }),
  perplexity: Object.freeze({
    id: 'perplexity',
    label: 'Perplexity',
    credentialEnv: 'PERPLEXITY_API_KEY',
    modelEnv: 'PERPLEXITY_MODEL',
    endpointEnv: 'PERPLEXITY_BASE_URL',
    defaultEndpoint: 'https://api.perplexity.ai/chat/completions',
  }),
  'nvidia-nim': Object.freeze({
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    credentialEnv: 'NVIDIA_NIM_API_KEY',
    modelEnv: 'NVIDIA_NIM_MODEL',
    endpointEnv: 'NVIDIA_NIM_BASE_URL',
    defaultEndpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
  }),
});

const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));
const CREDENTIAL_ENV_NAMES = Object.freeze(PROVIDER_IDS.map((id) => PROVIDERS[id].credentialEnv));

function describeProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw crucibleError('CRU-0033', `Unknown AI provider "${id}". Registered providers are ${PROVIDER_IDS.join(', ')}.`);
  return provider;
}

// Returns whether a credential is present, never the credential. Callers that need to decide
// whether a provider can be reached use this; callers that need to actually call the provider
// use `credentialFor`, which is the only function that returns a secret value.
function credentialPresent(id, env = process.env) {
  return Boolean(String(env[describeProvider(id).credentialEnv] || '').trim());
}

function credentialFor(id, env = process.env) {
  const provider = describeProvider(id);
  const value = String(env[provider.credentialEnv] || '').trim();
  if (!value) throw crucibleError('CRU-0033', `${provider.label} has no credential. Set ${provider.credentialEnv} in the environment or as a repository secret; never place it in a source file, a committed prompt, or a governance artifact.`);
  return value;
}

function endpointFor(id, env = process.env) {
  const provider = describeProvider(id);
  return String(env[provider.endpointEnv] || '').trim() || provider.defaultEndpoint;
}

function modelFor(id, env = process.env) {
  const provider = describeProvider(id);
  return String(env[provider.modelEnv] || '').trim() || null;
}

// Every credential value currently in the environment, so text can be checked against the real
// secrets rather than against a guess at what a secret looks like.
function knownSecretValues(env = process.env) {
  const values = [];
  for (const name of CREDENTIAL_ENV_NAMES) {
    const value = String(env[name] || '').trim();
    // Very short values are ignored: a one- or two-character "secret" would match half the file
    // and turn the leak check into noise that gets disabled.
    if (value.length >= 8) values.push({ name, value });
  }
  return values;
}

function redact(text, env = process.env) {
  let output = String(text == null ? '' : text);
  for (const { name, value } of knownSecretValues(env)) output = output.split(value).join(`[redacted:${name}]`);
  return output;
}

// The check that keeps secrets out of the permanent record. It looks for the actual values, and
// also for the common shapes of a pasted key, because the value that leaks is often from a
// different environment than the one running the audit.
const CREDENTIAL_SHAPES = Object.freeze([
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'Anthropic-style key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'Perplexity-style key', pattern: /\bpplx-[A-Za-z0-9]{16,}\b/ },
  { name: 'NVIDIA NIM-style key', pattern: /\bnvapi-[A-Za-z0-9_-]{16,}\b/ },
]);

function findCredentialLeaks(text, { env = process.env, label = 'artifact' } = {}) {
  const content = String(text == null ? '' : text);
  const findings = [];
  for (const { name, value } of knownSecretValues(env)) {
    if (content.includes(value)) findings.push({ type: 'Provider credential persisted', detail: `${label} contains the live value of ${name}. Credentials come from the environment and are never written into governance artifacts, prompts, or logs.` });
  }
  for (const shape of CREDENTIAL_SHAPES) {
    if (shape.pattern.test(content)) findings.push({ type: 'Provider credential persisted', detail: `${label} contains something shaped like an ${shape.name}. Remove it and rotate the key; a committed credential is compromised the moment it is written.` });
  }
  return findings;
}

function assertNoCredentialsPersisted(text, options = {}) {
  const findings = findCredentialLeaks(text, options);
  if (findings.length) throw crucibleError('CRU-0033', findings.map((item) => item.detail).join(' '));
  return { clean: true };
}

module.exports = {
  PROVIDERS, PROVIDER_IDS, CREDENTIAL_ENV_NAMES, CREDENTIAL_SHAPES,
  describeProvider, credentialPresent, credentialFor, endpointFor, modelFor,
  knownSecretValues, redact, findCredentialLeaks, assertNoCredentialsPersisted,
};

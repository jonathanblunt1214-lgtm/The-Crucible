"use strict";

const assert = require("assert");
const { validateVettedHandoffConfig } = require("../src/vettedHandoffConfigValidator");

function baseValidConfig() {
  return {
    contractVersion: "1.0-draft",
    artifactUri: "https://oversight.example/artifacts/crucible-corpus-v42",
    publisherKeyId: "oversight-key-2026-09",
    verificationPublicKeySecretName: "OVERSIGHT_VERIFICATION_PUBLIC_KEY",
    ciphertextAccessSecretName: "OVERSIGHT_ARTIFACT_ACCESS_TOKEN",
    expectedProjectId: "github:jonathanblunt1214-lgtm/The-Crucible",
    expectedRepository: "jonathanblunt1214-lgtm/The-Crucible",
    allowedRefs: ["refs/heads/development"],
    plaintextDigestAlgorithm: "sha256",
    artifactVersion: "42",
    expiresAt: null,
    onValidationFailure: "fail-closed",
    allowRawIntakeFallback: false,
  };
}

function run() {
  let passed = 0;
  const total = 8;

  {
    const result = validateVettedHandoffConfig(baseValidConfig(), {
      expectedRepository: "jonathanblunt1214-lgtm/The-Crucible",
      currentRef: "refs/heads/development",
    });
    assert.strictEqual(result.ok, true, "well-formed config should validate: " + result.errors.join("; "));
    passed++;
  }

  {
    const result = validateVettedHandoffConfig(null);
    assert.strictEqual(result.ok, false, "null config must fail");
    passed++;
  }

  {
    const config = baseValidConfig();
    delete config.artifactUri;
    const result = validateVettedHandoffConfig(config);
    assert.strictEqual(result.ok, false, "missing artifactUri must fail");
    passed++;
  }

  {
    const config = baseValidConfig();
    config.artifactUri = "REPLACE_WITH_OVERSIGHT_ARTIFACT_URI";
    const result = validateVettedHandoffConfig(config);
    assert.strictEqual(result.ok, false, "unfilled placeholder must fail");
    passed++;
  }

  {
    const config = baseValidConfig();
    config.allowRawIntakeFallback = true;
    const result = validateVettedHandoffConfig(config);
    assert.strictEqual(result.ok, false, "raw intake fallback opt-in must fail");
    passed++;
  }

  {
    const config = baseValidConfig();
    config.onValidationFailure = "fail-open";
    const result = validateVettedHandoffConfig(config);
    assert.strictEqual(result.ok, false, "non fail-closed policy must fail");
    passed++;
  }

  {
    const config = baseValidConfig();
    config.expectedRepository = "someone-else/other-repo";
    const result = validateVettedHandoffConfig(config, {
      expectedRepository: "jonathanblunt1214-lgtm/The-Crucible",
    });
    assert.strictEqual(result.ok, false, "repository mismatch against context must fail");
    passed++;
  }

  {
    const config = baseValidConfig();
    // 44 base64-ish chars: simulates an accidentally embedded raw key/secret value
    config.publisherKeyId = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoxMjM0NTY=";
    const result = validateVettedHandoffConfig(config);
    assert.strictEqual(result.ok, false, "field resembling an embedded secret must fail");
    passed++;
  }

  console.log(`vettedHandoffConfigValidator: ${passed}/${total} passed`);
  if (passed !== total) {
    process.exitCode = 1;
  }
}

run();

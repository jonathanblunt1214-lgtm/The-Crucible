"use strict";

const assert = require("assert");
const {
  performVettedHandoff,
  validateArtifactMetadata,
  validatePlaintextIntegrity,
  VettedHandoffError,
  ERROR_CODES,
} = require("../src/vettedLearningWorkerHandoff");

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

function baseContext() {
  return {
    expectedRepository: "jonathanblunt1214-lgtm/The-Crucible",
    currentRef: "refs/heads/development",
  };
}

function baseHeader(overrides) {
  return Object.assign(
    {
      projectId: "github:jonathanblunt1214-lgtm/The-Crucible",
      repository: "jonathanblunt1214-lgtm/The-Crucible",
      ref: "refs/heads/development",
      artifactVersion: "42",
      plaintextBytes: 11,
      plaintextSha256: "fake-digest",
    },
    overrides || {}
  );
}

async function expectRejection(promise, expectedCode, label) {
  try {
    await promise;
    throw new Error(`expected rejection for: ${label}`);
  } catch (err) {
    assert.ok(err instanceof VettedHandoffError, `${label}: expected VettedHandoffError, got ${err}`);
    assert.strictEqual(err.code, expectedCode, `${label}: expected code ${expectedCode}, got ${err.code}`);
  }
}

async function run() {
  let passed = 0;
  const total = 10;

  // 1. metadata validation: happy path
  {
    validateArtifactMetadata(baseHeader(), baseValidConfig(), baseContext());
    passed++;
  }

  // 2. metadata validation: repository mismatch
  {
    let threw = false;
    try {
      validateArtifactMetadata(baseHeader({ repository: "someone-else/other" }), baseValidConfig(), baseContext());
    } catch (err) {
      threw = err instanceof VettedHandoffError && err.code === ERROR_CODES.IDENTITY_MISMATCH;
    }
    assert.ok(threw, "repository mismatch should throw IDENTITY_MISMATCH");
    passed++;
  }

  // 3. metadata validation: ref not allowed
  {
    let threw = false;
    try {
      validateArtifactMetadata(baseHeader({ ref: "refs/heads/main" }), baseValidConfig(), baseContext());
    } catch (err) {
      threw = err instanceof VettedHandoffError && err.code === ERROR_CODES.IDENTITY_MISMATCH;
    }
    assert.ok(threw, "disallowed ref should throw IDENTITY_MISMATCH");
    passed++;
  }

  // 4. metadata validation: version mismatch
  {
    let threw = false;
    try {
      validateArtifactMetadata(baseHeader({ artifactVersion: "99" }), baseValidConfig(), baseContext());
    } catch (err) {
      threw = err instanceof VettedHandoffError && err.code === ERROR_CODES.DIGEST_MISMATCH;
    }
    assert.ok(threw, "version mismatch should throw DIGEST_MISMATCH");
    passed++;
  }

  // 5. metadata validation: expired config
  {
    const expiredConfig = Object.assign(baseValidConfig(), { expiresAt: "2020-01-01T00:00:00Z" });
    let threw = false;
    try {
      validateArtifactMetadata(baseHeader(), expiredConfig, baseContext());
    } catch (err) {
      threw = err instanceof VettedHandoffError && err.code === ERROR_CODES.ARTIFACT_EXPIRED;
    }
    assert.ok(threw, "expired config should throw ARTIFACT_EXPIRED");
    passed++;
  }

  // 6. plaintext integrity: byte count mismatch
  {
    let threw = false;
    try {
      validatePlaintextIntegrity(Buffer.from("short"), baseHeader({ plaintextBytes: 999 }), () => "x");
    } catch (err) {
      threw = err instanceof VettedHandoffError && err.code === ERROR_CODES.BYTE_COUNT_MISMATCH;
    }
    assert.ok(threw, "byte count mismatch should throw BYTE_COUNT_MISMATCH");
    passed++;
  }

  // 7. plaintext integrity: digest mismatch
  {
    let threw = false;
    try {
      validatePlaintextIntegrity(
        Buffer.from("hello world"),
        baseHeader({ plaintextBytes: 11, plaintextSha256: "expected-digest" }),
        () => "actual-digest"
      );
    } catch (err) {
      threw = err instanceof VettedHandoffError && err.code === ERROR_CODES.DIGEST_MISMATCH;
    }
    assert.ok(threw, "digest mismatch should throw DIGEST_MISMATCH");
    passed++;
  }

  // 8. full pipeline: invalid config fails closed before any port is called
  {
    const badConfig = Object.assign(baseValidConfig(), { artifactUri: "REPLACE_WITH_OVERSIGHT_ARTIFACT_URI" });
    await expectRejection(
      performVettedHandoff(badConfig, baseContext(), {}),
      ERROR_CODES.CONFIG_INVALID,
      "invalid config"
    );
    passed++;
  }

  // 9. full pipeline: unimplemented ports fail closed with NOT_YET_IMPLEMENTED
  // (resolveSecret's own NOT_YET_IMPLEMENTED VettedHandoffError propagates
  // as-is, by design: performVettedHandoff only re-wraps non-VettedHandoffError
  // failures, so a deliberate "not implemented yet" signal is never masked
  // as a generic secret-resolution failure.)
  {
    await expectRejection(
      performVettedHandoff(baseValidConfig(), baseContext(), {}),
      ERROR_CODES.NOT_YET_IMPLEMENTED,
      "unimplemented resolveSecret port"
    );
    passed++;
  }

  // 10. full pipeline: happy path with fully faked ports end to end
  {
    const plaintext = Buffer.from("hello world");
    const crypto = require("crypto");
    const digest = crypto.createHash("sha256").update(plaintext).digest("hex");

    const fakePorts = {
      async resolveSecret(name) {
        return `fake-value-for-${name}`;
      },
      async fetchArtifact(config) {
        return {
          header: baseHeader({ plaintextBytes: plaintext.length, plaintextSha256: digest }),
          plaintext,
          computeDigest: (buf) => crypto.createHash("sha256").update(buf).digest("hex"),
        };
      },
      async verifySignature(artifact, verificationKeyValue) {
        return { valid: true };
      },
    };

    const result = await performVettedHandoff(baseValidConfig(), baseContext(), fakePorts);
    assert.strictEqual(result.plaintext.toString(), "hello world");
    assert.strictEqual(result.header.repository, "jonathanblunt1214-lgtm/The-Crucible");
    passed++;
  }

  console.log(`vettedLearningWorkerHandoff: ${passed}/${total} passed`);
  if (passed !== total) {
    process.exitCode = 1;
  }
}

run();

"use strict";

/**
 * vettedLearningWorkerHandoff.js
 *
 * Orchestrates path B of the corpus-key handoff: instead of Crucible
 * restoring and decrypting the raw intake bundle itself
 * (hostedSourceBundle.restore), it fetches a vetted, signed artifact that
 * oversight publishes for the Learning-Worker, verifies it, and only then
 * hands plaintext to the existing intake pathway.
 *
 * STATUS: structurally complete, functionally stubbed on three primitives
 * that cannot be implemented until oversight supplies the contract in
 * governingDocuments/oversight/VETTED-LEARNING-WORKER-HANDOFF.md:
 *
 *   1. fetchArtifact()     - how to retrieve the vetted artifact bytes
 *   2. verifySignature()   - the actual signature scheme / key material
 *   3. resolveSecret()     - how a secret *name* becomes a usable value
 *      at runtime (this project's existing secret-resolution convention,
 *      wherever it already exists for CRUCIBLE_HOSTED_STORE_KEY, should be
 *      reused rather than reinvented here)
 *
 * Everything else - config validation, identity binding, metadata checks,
 * fail-closed error taxonomy, and the handoff into intakePathways - is real
 * and tested against fakes. When oversight responds, only the three
 * NOT_YET_IMPLEMENTED throws below need real bodies; nothing else in this
 * file should need to change.
 *
 * This module never falls back to hostedSourceBundle.restore(). That
 * decision is explicitly out of scope (see allowRawIntakeFallback in the
 * validator) and must be made by a human, not by catch-block logic.
 */

const { validateVettedHandoffConfig } = require("./vettedHandoffConfigValidator");

class VettedHandoffError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "VettedHandoffError";
    this.code = code;
    this.details = details || {};
  }
}

const ERROR_CODES = Object.freeze({
  CONFIG_INVALID: "CONFIG_INVALID",
  ARTIFACT_FETCH_FAILED: "ARTIFACT_FETCH_FAILED",
  SIGNATURE_INVALID: "SIGNATURE_INVALID",
  IDENTITY_MISMATCH: "IDENTITY_MISMATCH",
  DIGEST_MISMATCH: "DIGEST_MISMATCH",
  BYTE_COUNT_MISMATCH: "BYTE_COUNT_MISMATCH",
  ARTIFACT_EXPIRED: "ARTIFACT_EXPIRED",
  UNKNOWN_KEY_ID: "UNKNOWN_KEY_ID",
  SECRET_RESOLUTION_FAILED: "SECRET_RESOLUTION_FAILED",
  NOT_YET_IMPLEMENTED: "NOT_YET_IMPLEMENTED",
});

/**
 * Injected by the caller in production; overridable in tests. Kept as
 * plain function fields on the exported object (rather than module-level
 * closures) so tests can substitute fakes without mocking require().
 */
const defaultPorts = {
  /**
   * Resolve a secret *name* (e.g. "OVERSIGHT_ARTIFACT_ACCESS_TOKEN") to its
   * runtime value. Must be supplied by the caller - this module never reads
   * process.env or any secret store directly, so a missing implementation
   * fails closed rather than silently reading nothing.
   */
  resolveSecret(_secretName) {
    throw new VettedHandoffError(
      ERROR_CODES.NOT_YET_IMPLEMENTED,
      "resolveSecret is not implemented: oversight has not yet supplied secret names or a resolution convention"
    );
  },

  /**
   * Fetch the raw artifact bytes plus its authenticated header/metadata from
   * config.artifactUri. Shape TBD by oversight (release asset, artifact
   * registry, dispatch payload, etc).
   */
  async fetchArtifact(_config, _accessSecretValue) {
    throw new VettedHandoffError(
      ERROR_CODES.NOT_YET_IMPLEMENTED,
      "fetchArtifact is not implemented: oversight has not yet supplied the artifact location/transport"
    );
  },

  /**
   * Verify the oversight signature over the fetched artifact using
   * config.publisherKeyId and the resolved verification key. Must return
   * { valid: boolean, reason?: string }.
   */
  async verifySignature(_artifact, _verificationKeyValue, _config) {
    throw new VettedHandoffError(
      ERROR_CODES.NOT_YET_IMPLEMENTED,
      "verifySignature is not implemented: oversight has not yet supplied the signature scheme/key material"
    );
  },
};

/**
 * Validate that the artifact's authenticated metadata matches what this
 * project expects, mirroring the checks validateIdentity already performs
 * on the raw intake bundle (project id, repository, ref, digest, byte
 * count, expiry). This part IS fully implementable now because the header
 * shape is already established by the existing raw-bundle format described
 * in governingDocuments/oversight/VETTED-LEARNING-WORKER-HANDOFF.md.
 */
function validateArtifactMetadata(header, config, context) {
  if (!header || typeof header !== "object") {
    throw new VettedHandoffError(
      ERROR_CODES.ARTIFACT_FETCH_FAILED,
      "artifact header missing or malformed"
    );
  }

  if (header.projectId !== config.expectedProjectId) {
    throw new VettedHandoffError(
      ERROR_CODES.IDENTITY_MISMATCH,
      `artifact projectId (${header.projectId}) does not match expected (${config.expectedProjectId})`
    );
  }

  if (header.repository !== config.expectedRepository) {
    throw new VettedHandoffError(
      ERROR_CODES.IDENTITY_MISMATCH,
      `artifact repository (${header.repository}) does not match expected (${config.expectedRepository})`
    );
  }

  const ref = context && context.currentRef;
  if (ref && !config.allowedRefs.includes(ref)) {
    throw new VettedHandoffError(
      ERROR_CODES.IDENTITY_MISMATCH,
      `current ref (${ref}) is not in allowedRefs`
    );
  }

  if (header.ref && !config.allowedRefs.includes(header.ref)) {
    throw new VettedHandoffError(
      ERROR_CODES.IDENTITY_MISMATCH,
      `artifact header ref (${header.ref}) is not in allowedRefs`
    );
  }

  if (config.artifactVersion && header.artifactVersion !== config.artifactVersion) {
    throw new VettedHandoffError(
      ERROR_CODES.DIGEST_MISMATCH,
      `artifact version (${header.artifactVersion}) does not match expected (${config.artifactVersion})`,
      { expected: config.artifactVersion, actual: header.artifactVersion }
    );
  }

  if (config.expiresAt) {
    const expiry = new Date(config.expiresAt).getTime();
    const now = Date.now();
    if (!Number.isNaN(expiry) && now > expiry) {
      throw new VettedHandoffError(
        ERROR_CODES.ARTIFACT_EXPIRED,
        `vetted handoff config expired at ${config.expiresAt}`
      );
    }
  }

  return true;
}

/**
 * Verify plaintext integrity against the header's declared digest and byte
 * count, once plaintext is available. Kept separate from signature
 * verification: a valid signature over a header does not by itself prove
 * the decrypted/decoded plaintext matches that header.
 */
function validatePlaintextIntegrity(plaintextBuffer, header, computeDigestFn) {
  if (typeof header.plaintextBytes === "number" && plaintextBuffer.length !== header.plaintextBytes) {
    throw new VettedHandoffError(
      ERROR_CODES.BYTE_COUNT_MISMATCH,
      `plaintext byte count (${plaintextBuffer.length}) does not match header (${header.plaintextBytes})`
    );
  }

  if (header.plaintextSha256 && typeof computeDigestFn === "function") {
    const actualDigest = computeDigestFn(plaintextBuffer);
    if (actualDigest !== header.plaintextSha256) {
      throw new VettedHandoffError(
        ERROR_CODES.DIGEST_MISMATCH,
        `plaintext digest (${actualDigest}) does not match header (${header.plaintextSha256})`
      );
    }
  }

  return true;
}

/**
 * Top-level entry point. Runs the full fail-closed pipeline:
 *   1. validate config shape (no secrets, no placeholders, correct repo/ref)
 *   2. resolve the two secret names to values via the injected port
 *   3. fetch the artifact via the injected port
 *   4. validate the artifact's authenticated metadata against config/context
 *   5. verify the oversight signature via the injected port
 *   6. validate plaintext integrity (digest + byte count)
 *   7. return plaintext for the caller to route into the existing
 *      corroboration/learning pipeline via intakePathways
 *
 * Any failure at any step throws a VettedHandoffError with a non-sensitive
 * code and message. There is no fallback path; callers must not catch this
 * and retry against hostedSourceBundle.restore().
 */
async function performVettedHandoff(config, context, ports) {
  const resolvedPorts = Object.assign({}, defaultPorts, ports || {});

  const validation = validateVettedHandoffConfig(config, context);
  if (!validation.ok) {
    throw new VettedHandoffError(
      ERROR_CODES.CONFIG_INVALID,
      "vetted handoff config failed validation",
      { errors: validation.errors }
    );
  }

  let accessSecretValue;
  let verificationKeyValue;
  try {
    accessSecretValue = await resolvedPorts.resolveSecret(config.ciphertextAccessSecretName);
    verificationKeyValue = await resolvedPorts.resolveSecret(config.verificationPublicKeySecretName);
  } catch (err) {
    if (err instanceof VettedHandoffError) throw err;
    throw new VettedHandoffError(
      ERROR_CODES.SECRET_RESOLUTION_FAILED,
      "failed to resolve one or more configured secret names",
      { cause: err && err.message }
    );
  }

  let artifact;
  try {
    artifact = await resolvedPorts.fetchArtifact(config, accessSecretValue);
  } catch (err) {
    if (err instanceof VettedHandoffError) throw err;
    throw new VettedHandoffError(
      ERROR_CODES.ARTIFACT_FETCH_FAILED,
      "failed to fetch vetted artifact",
      { cause: err && err.message }
    );
  }

  if (!artifact || !artifact.header) {
    throw new VettedHandoffError(
      ERROR_CODES.ARTIFACT_FETCH_FAILED,
      "fetched artifact is missing a header"
    );
  }

  validateArtifactMetadata(artifact.header, config, context);

  const signatureResult = await resolvedPorts.verifySignature(artifact, verificationKeyValue, config);
  if (!signatureResult || signatureResult.valid !== true) {
    throw new VettedHandoffError(
      ERROR_CODES.SIGNATURE_INVALID,
      "artifact signature verification failed",
      { reason: signatureResult && signatureResult.reason }
    );
  }

  if (!artifact.plaintext) {
    throw new VettedHandoffError(
      ERROR_CODES.ARTIFACT_FETCH_FAILED,
      "verified artifact did not yield plaintext"
    );
  }

  validatePlaintextIntegrity(artifact.plaintext, artifact.header, artifact.computeDigest);

  return {
    plaintext: artifact.plaintext,
    header: {
      projectId: artifact.header.projectId,
      repository: artifact.header.repository,
      ref: artifact.header.ref,
      artifactVersion: artifact.header.artifactVersion,
      plaintextBytes: artifact.header.plaintextBytes,
    },
  };
}

module.exports = {
  performVettedHandoff,
  validateArtifactMetadata,
  validatePlaintextIntegrity,
  VettedHandoffError,
  ERROR_CODES,
  defaultPorts,
};

"use strict";

/**
 * validateVettedHandoffConfig
 *
 * Validates a vetted Learning-Worker handoff configuration object against
 * the contract defined in
 * governingDocuments/oversight/VETTED-LEARNING-WORKER-HANDOFF.md.
 *
 * This module performs NO network access, NO decryption, and NO secret
 * resolution. It only checks that a configuration object is well-formed and
 * safe to act on later. It deliberately rejects any configuration that:
 *   - is missing required non-secret fields,
 *   - contains what looks like an embedded secret value rather than a
 *     secret *name*,
 *   - targets a repository or ref other than this project's own,
 *   - or explicitly requests a raw-intake fallback.
 *
 * It is the caller's responsibility to keep secret values out of any object
 * passed here; this module adds a best-effort shape check as a second line
 * of defense, not a guarantee.
 */

const REQUIRED_STRING_FIELDS = [
  "artifactUri",
  "publisherKeyId",
  "verificationPublicKeySecretName",
  "ciphertextAccessSecretName",
  "expectedProjectId",
  "expectedRepository",
  "plaintextDigestAlgorithm",
  "artifactVersion",
];

const PLACEHOLDER_PREFIX = "REPLACE_WITH_";

function looksLikeEmbeddedSecret(value) {
  if (typeof value !== "string") return false;
  // Heuristic only: long high-entropy base64/hex-ish strings in a field that
  // should be a short name or URI are treated as suspicious.
  const isSuspiciouslyLong = value.length > 200;
  const looksBase64ish = /^[A-Za-z0-9+/=]{40,}$/.test(value);
  return isSuspiciouslyLong || looksBase64ish;
}

function validateVettedHandoffConfig(config, context) {
  const errors = [];

  if (!config || typeof config !== "object") {
    return { ok: false, errors: ["config must be an object"] };
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = config[field];
    if (typeof value !== "string" || value.length === 0) {
      errors.push(`missing or empty required field: ${field}`);
      continue;
    }
    if (value.startsWith(PLACEHOLDER_PREFIX)) {
      errors.push(`field ${field} still contains an unfilled placeholder`);
    }
    if (looksLikeEmbeddedSecret(value)) {
      errors.push(
        `field ${field} looks like an embedded secret value rather than a name/URI; refusing to proceed`
      );
    }
  }

  if (!Array.isArray(config.allowedRefs) || config.allowedRefs.length === 0) {
    errors.push("allowedRefs must be a non-empty array");
  }

  if (config.allowRawIntakeFallback === true) {
    errors.push(
      "allowRawIntakeFallback must not be true; raw-intake fallback is a human decision, not a config default"
    );
  }

  if (config.onValidationFailure !== "fail-closed") {
    errors.push('onValidationFailure must be exactly "fail-closed"');
  }

  if (context && context.expectedRepository) {
    if (config.expectedRepository !== context.expectedRepository) {
      errors.push(
        `expectedRepository (${config.expectedRepository}) does not match running context (${context.expectedRepository})`
      );
    }
  }

  if (context && context.currentRef) {
    if (Array.isArray(config.allowedRefs) && !config.allowedRefs.includes(context.currentRef)) {
      errors.push(
        `currentRef (${context.currentRef}) is not in allowedRefs`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateVettedHandoffConfig };

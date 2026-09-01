# Vetted Learning-Worker Handoff Contract

## Status
DRAFT — no fetch, decrypt, or restore logic implemented yet. This document and
its accompanying schema exist to define the interface Crucible will consume
once oversight publishes the vetted artifact contract. Nothing in this change
grants Crucible access to the raw intake corpus or to any secret value.

## Background

`CRUCIBLE_SOURCE_BUNDLE_KEY` (raw intake key) was rotated by the oversight
side to an oversight-only key. Crucible's copy is stale, so the hosted proof
can no longer decrypt `hostedSourceBundle`'s restored ciphertext — it fails
at the GCM authentication-tag check with
`Unsupported state or unable to authenticate data`.

Three keys exist and must not be conflated:

| Secret | Encrypts | Status | Held by |
|---|---|---|---|
| `CRUCIBLE_SOURCE_BUNDLE_KEY` | raw corpus at intake | stale (this break) | previously Crucible, now oversight-only |
| (vetted-output key, name TBD by oversight) | oversight's vetted, signed re-encrypted output | to be defined | oversight / Learning-Worker |
| `CRUCIBLE_HOSTED_STORE_KEY` | Crucible's own durable encrypted learning state | fine, untouched | Crucible |

## Decision

Adopt path **B**: Crucible stops reading the raw intake corpus. The hosted
proof instead consumes the vetted, signed ciphertext that oversight publishes
for the Learning-Worker. Crucible never holding the raw intake key is the
correct end state, not a gap — oversight's information gate is meant to sit
between raw material and the learner.

Path **A** (temporarily rotating `CRUCIBLE_SOURCE_BUNDLE_KEY` back into
Crucible's hands) may be used as a deliberate, time-boxed unblock while B is
built, at the owner's discretion. It is out of scope for this change and is
not implemented here.

## What oversight must supply

Before any restore/verify code is written against this contract, oversight
must provide, through an approved out-of-band channel — never through a
commit, PR body, issue, workflow log, or chat transcript:

1. **Artifact location** — where the vetted, signed ciphertext for this
   project/ref is published (e.g. a release asset URL, an artifact registry
   path, or a repository dispatch payload location).
2. **Publisher verification material** — the public key, certificate, or key
   ID used to verify the oversight signature over the artifact, and the
   signature scheme.
3. **Secret names only** — the name(s) of the GitHub Actions secrets that
   grant access to fetch or decrypt the vetted artifact. Secret *values* are
   configured directly in GitHub Settings → Secrets and variables → Actions
   by an authorized owner, never pasted into source, issues, or chat.
4. **Authenticated metadata contract** — the expected header fields Crucible
   must validate before trusting plaintext: project ID, repository, allowed
   ref(s), plaintext digest algorithm, plaintext byte count, artifact
   version, and any expiry/rotation policy.
5. **Rotation/expiry policy** — how Crucible should behave when the artifact
   or verification key is rotated or expires (fail closed, not fail open).

## Required behavior of the eventual implementation

- **Fail closed.** Any of the following must stop the hosted proof with a
  clear, non-sensitive diagnostic rather than falling back to raw intake:
  missing configuration, unreachable artifact, signature verification
  failure, repository/ref mismatch, digest mismatch, byte-count mismatch,
  expired artifact, or unrecognized key ID.
- **No raw-intake fallback.** The implementation must not silently retry
  against `hostedSourceBundle`'s raw intake restore path if the vetted path
  fails. That decision belongs to a human, not to error-handling code.
- **Identity binding.** The artifact must be validated against this
  project's `github:` identity and the exact ref it was published for, the
  same way `validateIdentity` already binds the raw bundle today.
- **Non-sensitive diagnostics only.** Logs and reports may include artifact
  ID, key ID, ref, and hash prefixes. They must never include secret values,
  full plaintext, or full ciphertext.
- **No re-encryption to the old key.** Nothing in this contract, or its
  implementation, should re-encrypt any corpus back to the rotated-away
  `CRUCIBLE_SOURCE_BUNDLE_KEY`. That would undo the rotation oversight
  performed deliberately.

## Non-goals of this change

This commit does not:

- Fetch, decrypt, or restore any corpus data.
- Add, remove, or reference any live secret value.
- Change `hostedLearningProof.js` or `hostedSourceBundle.js` behavior.
- Decide between path A and path B execution — it only specifies path B's
  contract so implementation can proceed once oversight responds.

## Next step

Once oversight supplies the five items above, implement a
`vettedLearningWorkerHandoff.js` module that validates the contract, verifies
the signature and metadata, and only then hands vetted plaintext to the
existing corroboration/learning pipeline. That implementation is out of
scope for this scaffold.

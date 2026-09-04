// Exclusive mutation ownership.
//
// Several AIs may work the same project at once. What they may not do is change the same code at
// the same time: two providers writing the same file produce a merge, not a decision, and the
// merge silently picks a winner nobody authorised. So discussion is shared and mutation is
// exclusive - any AI may read, test, review, critique and propose against a claimed scope, and
// exactly one may mutate it until ownership is explicitly released or handed off.
//
// A claim lives in AI-HANDOFF.json (future intent), never in DEVLOG.md (past fact). It names the
// task, the owner, the scope it locks, why, and when. Overlap is decided structurally rather than
// by string equality, because "src/a.js" and "src/" are the same lock held at two different
// widths, and a line-range claim inside a file a directory claim already covers is still the same
// bytes. Getting that wrong is the whole failure this module exists to prevent.
const { crucibleError } = require('./failureCodes');

const CLAIM_STATUSES = Object.freeze(['active', 'released', 'handed-off']);
const ACTIVE_STATUS = 'active';
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;

// Trailing-slash and "./" spellings of one path are the same lock. Normalising here means the
// overlap test never has to care which spelling a claim happened to use.
function normalizeScopePath(value) {
  const text = String(value == null ? '' : value).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return text.replace(/\/+$/, '');
}

function isDirectoryPrefix(candidate, other) {
  return other === candidate || other.startsWith(`${candidate}/`);
}

// Two paths overlap when they are equal or one contains the other. Containment matters in both
// directions: claiming "src/" locks "src/a.js", and claiming "src/a.js" blocks a later "src/".
function pathsOverlap(a, b) {
  const left = normalizeScopePath(a);
  const right = normalizeScopePath(b);
  if (!left || !right) return false;
  return isDirectoryPrefix(left, right) || isDirectoryPrefix(right, left);
}

function regionsIntersect(a, b) {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function normalizeRegion(region) {
  if (!region || typeof region !== 'object') return null;
  const path = normalizeScopePath(region.path);
  const startLine = Number(region.startLine);
  const endLine = Number(region.endLine);
  if (!path || !Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) return null;
  return { path, startLine, endLine };
}

function scopePaths(scope) {
  if (!scope || typeof scope !== 'object') return [];
  return (Array.isArray(scope.paths) ? scope.paths : []).map(normalizeScopePath).filter(Boolean);
}

function scopeRegions(scope) {
  if (!scope || typeof scope !== 'object') return [];
  return (Array.isArray(scope.regions) ? scope.regions : []).map(normalizeRegion).filter(Boolean);
}

// A whole-path claim swallows any region claim inside it, so a region is only compared against
// another region when neither side holds the containing path.
function scopesOverlap(left, right) {
  const leftPaths = scopePaths(left);
  const rightPaths = scopePaths(right);
  for (const a of leftPaths) for (const b of rightPaths) if (pathsOverlap(a, b)) return { kind: 'path', detail: a === b ? a : `${a} and ${b}` };

  const leftRegions = scopeRegions(left);
  const rightRegions = scopeRegions(right);
  for (const region of leftRegions) for (const b of rightPaths) if (pathsOverlap(region.path, b)) return { kind: 'path-region', detail: `${b} covers ${region.path}:${region.startLine}-${region.endLine}` };
  for (const region of rightRegions) for (const a of leftPaths) if (pathsOverlap(region.path, a)) return { kind: 'path-region', detail: `${a} covers ${region.path}:${region.startLine}-${region.endLine}` };
  for (const a of leftRegions) for (const b of rightRegions) if (a.path === b.path && regionsIntersect(a, b)) return { kind: 'region', detail: `${a.path}:${a.startLine}-${a.endLine} and ${b.path}:${b.startLine}-${b.endLine}` };
  return null;
}

function ownerLabel(owner) {
  if (!owner || typeof owner !== 'object') return 'unknown owner';
  const parts = [owner.provider, owner.model, owner.agent].filter((item) => typeof item === 'string' && item.trim());
  return parts.length ? parts.join('/') : 'unknown owner';
}

function sameOwner(a, b) {
  if (!a || !b) return false;
  return String(a.provider || '') === String(b.provider || '') && String(a.agent || '') === String(b.agent || '');
}

function validateClaim(claim, label = 'mutationClaims entry') {
  const findings = [];
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return [`${label} must be an object.`];
  if (!TASK_ID_PATTERN.test(claim.taskId || '')) findings.push(`${label}.taskId must be a stable lowercase identifier.`);
  if (!claim.owner || typeof claim.owner !== 'object' || Array.isArray(claim.owner) || typeof claim.owner.provider !== 'string' || !claim.owner.provider.trim()) findings.push(`${label}.owner.provider is required.`);
  if (!CLAIM_STATUSES.includes(claim.status)) findings.push(`${label}.status must be one of ${CLAIM_STATUSES.join(', ')}.`);
  if (typeof claim.purpose !== 'string' || !claim.purpose.trim()) findings.push(`${label}.purpose is required so a reader knows why the scope is locked.`);
  if (!ISO_PATTERN.test(claim.acquiredAt || '')) findings.push(`${label}.acquiredAt must be an ISO-8601 UTC timestamp.`);
  if (!scopePaths(claim.scope).length && !scopeRegions(claim.scope).length) findings.push(`${label}.scope must claim at least one path or code region.`);
  if (claim.status === 'released' && !ISO_PATTERN.test(claim.releasedAt || '')) findings.push(`${label}.releasedAt is required once the claim is released.`);
  if (claim.status === 'handed-off') {
    const to = claim.handedOffTo;
    if (!to || typeof to !== 'object' || Array.isArray(to) || typeof to.provider !== 'string' || !to.provider.trim()) findings.push(`${label}.handedOffTo.provider is required once the claim is handed off.`);
    if (!ISO_PATTERN.test(claim.releasedAt || '')) findings.push(`${label}.releasedAt must record when ownership left the previous owner.`);
  }
  return findings;
}

function activeClaims(claims) {
  return (Array.isArray(claims) ? claims : []).filter((claim) => claim && claim.status === ACTIVE_STATUS);
}

// The core invariant: no two active claims may overlap. Released and handed-off claims are
// history and are deliberately not compared - the whole point of handing off is that the
// successor's claim covers the same scope.
function auditMutationClaims(claims) {
  const findings = [];
  const list = Array.isArray(claims) ? claims : [];
  const seen = new Set();
  for (const [index, claim] of list.entries()) {
    for (const message of validateClaim(claim, `mutationClaims[${index}]`)) findings.push({ type: 'Mutation claim invalid', detail: message });
    if (claim && claim.taskId) {
      const key = `${claim.taskId}::${claim.status}`;
      if (claim.status === ACTIVE_STATUS && seen.has(key)) findings.push({ type: 'Mutation claim invalid', detail: `mutationClaims[${index}].taskId duplicates an active claim ${claim.taskId}.` });
      seen.add(key);
    }
  }
  const active = activeClaims(list);
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const overlap = scopesOverlap(active[i].scope, active[j].scope);
      if (!overlap) continue;
      findings.push({
        type: 'Overlapping mutation claim',
        detail: `${active[i].taskId} (${ownerLabel(active[i].owner)}) and ${active[j].taskId} (${ownerLabel(active[j].owner)}) both hold ${overlap.detail}. Exactly one canonical mutation stream is allowed per scope; the other may read, test, review and propose, but not mutate.`,
      });
    }
  }
  return { claims: list.length, active: active.length, findings };
}

// Scopes frozen by an unresolved disagreement. A conflict freezes only what it contests: every
// other scope, and every read-only activity anywhere, keeps moving.
function contestedScopes(conflicts) {
  const list = Array.isArray(conflicts) ? conflicts : [];
  return list.filter((conflict) => conflict && conflict.status === 'open' && conflict.contestedScope).map((conflict) => ({ id: conflict.id, scope: conflict.contestedScope }));
}

function claimCovering(claims, path) {
  return activeClaims(claims).find((claim) => scopesOverlap(claim.scope, { paths: [path] })) || null;
}

// The gate a would-be mutator passes through. Reads never call this; that asymmetry is the
// design, not an oversight.
function assertMutationAllowed({ claims = [], conflicts = [], actor, paths = [] }) {
  const targets = (Array.isArray(paths) ? paths : []).map(normalizeScopePath).filter(Boolean);
  for (const target of targets) {
    for (const contested of contestedScopes(conflicts)) {
      if (scopesOverlap(contested.scope, { paths: [target] })) {
        throw crucibleError('CRU-0031', `${target} is frozen by unresolved AI conflict ${contested.id}. Read, test, review and propose against it freely; do not mutate it until the owner resolves the conflict. Unrelated scopes are unaffected.`);
      }
    }
    const holder = claimCovering(claims, target);
    if (holder && !sameOwner(holder.owner, actor)) {
      throw crucibleError('CRU-0030', `${target} is exclusively claimed by ${ownerLabel(holder.owner)} under task ${holder.taskId}. ${ownerLabel(actor)} may read, test, review, critique and propose changes to it, but may not mutate it until ownership is explicitly released or handed off.`);
    }
  }
  return { allowed: true, paths: targets };
}

function acquireClaim(claims, claim) {
  const list = Array.isArray(claims) ? [...claims] : [];
  const invalid = validateClaim(claim);
  if (invalid.length) throw crucibleError('CRU-0029', `Mutation claim is not recordable: ${invalid.join(' ')}`);
  for (const existing of activeClaims(list)) {
    const overlap = scopesOverlap(existing.scope, claim.scope);
    if (overlap) throw crucibleError('CRU-0029', `Cannot claim ${overlap.detail}: it is already held by ${ownerLabel(existing.owner)} under task ${existing.taskId}. Wait for release, request a handoff, or claim a non-overlapping scope.`);
  }
  list.push(claim);
  return list;
}

function releaseClaim(claims, taskId, releasedAt) {
  const list = Array.isArray(claims) ? [...claims] : [];
  const index = list.findIndex((claim) => claim && claim.taskId === taskId && claim.status === ACTIVE_STATUS);
  if (index < 0) throw crucibleError('CRU-0029', `No active mutation claim ${taskId} to release.`);
  list[index] = { ...list[index], status: 'released', releasedAt };
  return list;
}

// Handoff is the only way a scope changes hands without passing through an unclaimed moment, so
// the successor's claim is created in the same operation that closes the predecessor's.
function handOffClaim(claims, taskId, { to, at, purpose, taskId: successorTaskId }) {
  const list = Array.isArray(claims) ? [...claims] : [];
  const index = list.findIndex((claim) => claim && claim.taskId === taskId && claim.status === ACTIVE_STATUS);
  if (index < 0) throw crucibleError('CRU-0029', `No active mutation claim ${taskId} to hand off.`);
  const previous = list[index];
  list[index] = { ...previous, status: 'handed-off', handedOffTo: to, releasedAt: at };
  const successor = {
    taskId: successorTaskId || `${taskId}-handoff`,
    owner: to,
    scope: previous.scope,
    purpose: purpose || previous.purpose,
    status: ACTIVE_STATUS,
    acquiredAt: at,
    handedOffTo: null,
    releasedAt: null,
  };
  const invalid = validateClaim(successor);
  if (invalid.length) throw crucibleError('CRU-0029', `Handoff would create an invalid claim: ${invalid.join(' ')}`);
  list.push(successor);
  return list;
}

module.exports = {
  CLAIM_STATUSES, ACTIVE_STATUS,
  normalizeScopePath, pathsOverlap, scopesOverlap, ownerLabel, sameOwner,
  validateClaim, auditMutationClaims, activeClaims, contestedScopes, claimCovering,
  assertMutationAllowed, acquireClaim, releaseClaim, handOffClaim,
};

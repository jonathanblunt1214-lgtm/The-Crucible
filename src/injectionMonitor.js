'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.join('governingDocuments', 'INJECTION-PREREQUISITES.json');
const ACTIVE_STATES = new Set(['active', 'monitoring', 'repairing', 'retest']);
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'blocked', 'expired']);
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

function nonPlaceholder(value) {
  const text = String(value || '').trim();
  return Boolean(text) && !/[<>]/.test(text) && !/^(null|none|unknown)$/i.test(text);
}

function parseTime(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function loadManifest(root) {
  const file = path.join(root, MANIFEST_PATH);
  if (!fs.existsSync(file)) return { skipped:true, file, manifest:null };
  try { return { skipped:false, file, manifest:JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (error) { return { skipped:false, file, manifest:null, parseError:error.message }; }
}

function verifyInjectionMonitor(root, environment = process.env, nowMs = Date.now()) {
  const loaded = loadManifest(root);
  if (loaded.skipped) return { ok:true, skipped:true, findings:[], state:'absent' };
  const findings = [];
  if (loaded.parseError || !loaded.manifest) {
    findings.push(`invalid manifest JSON: ${loaded.parseError || 'unknown parse error'}`);
    return { ok:false, skipped:false, findings, state:'invalid' };
  }

  const manifest = loaded.manifest;
  const lifecycle = manifest.injectionLifecycle || {};
  const monitor = manifest.monitoringLink || {};
  const credential = manifest.injectionCredential || {};
  const activation = manifest.activation || {};
  const lifecycleState = String(lifecycle.status || '').trim().toLowerCase();
  const monitorState = String(monitor.state || '').trim().toLowerCase();
  const expectedRepository = environment.CRUCIBLE_INJECTION_TARGET_REPOSITORY || environment.GITHUB_REPOSITORY || '';
  const expectedBranch = environment.CRUCIBLE_INJECTION_DEVELOPMENT_BRANCH || environment.GITHUB_REF_NAME || '';

  if (!ACTIVE_STATES.has(lifecycleState) && !TERMINAL_STATES.has(lifecycleState)) {
    findings.push('injectionLifecycle.status must be active, completed, cancelled, blocked, or expired');
  }

  const startsAt = parseTime(lifecycle.startedAt || monitor.activatedAt);
  const expiresAt = parseTime(lifecycle.expiresAt || monitor.expiresAt);
  if (startsAt === null) findings.push('missing or invalid injection activation timestamp');
  if (expiresAt === null) findings.push('missing or invalid injection expiration timestamp');
  if (startsAt !== null && expiresAt !== null) {
    if (expiresAt <= startsAt) findings.push('injection expiration must be after activation');
    if (expiresAt - startsAt > MAX_LIFETIME_MS) findings.push('injection monitor lifetime exceeds 24 hours');
  }

  if (ACTIVE_STATES.has(lifecycleState)) {
    if (startsAt !== null && nowMs < startsAt) findings.push('active injection has not reached its activation time');
    if (expiresAt !== null && nowMs >= expiresAt) findings.push('active injection has expired and must be disabled');
    if (monitorState !== 'monitoring' && monitorState !== 'repairing' && monitorState !== 'retest') findings.push('active injection monitor is not running');
    if (!nonPlaceholder(lifecycle.authorizationId || monitor.authorizationId)) findings.push('active injection authorization identity is missing');
    if (!nonPlaceholder(monitor.mechanismType)) findings.push('monitor mechanism type is missing');
    if (!nonPlaceholder(monitor.mechanismIdentity)) findings.push('monitor mechanism identity is missing');
    if (!nonPlaceholder(monitor.activationProof)) findings.push('monitor activation proof is missing');
    if (monitor.evidenceRetrievalVerified !== true) findings.push('monitor evidence retrieval is not verified');
    if (monitor.repairCapabilityVerified !== true) findings.push('monitor repair capability is not verified');
    if (monitor.autonomousRepairRequiredWhenAuthorized !== true) findings.push('autonomous repair is not required');
    if (monitor.automaticRepairAndRetestWhenAuthorized !== true) findings.push('automatic repair/retest is not required');
    if (monitor.statusUpdatesDoNotSatisfyRepairObligation !== true) findings.push('status-only updates are not explicitly rejected');
    if (monitor.deduplicateByUnderlyingDefect !== true) findings.push('underlying-defect report deduplication is not enabled');
    if (monitor.developmentFirstRepairRequired !== true) findings.push('development-first repair is not required');
    if (monitor.directProductionMutationForbidden !== true) findings.push('direct production mutation is not forbidden');
    if (monitor.nonInjectionUseForbidden !== true || monitor.disableWhenNoActiveInjection !== true) findings.push('monitor is not injection-exclusive/off outside injection');
    if (monitor.secretValueStored !== false || manifest.secretValueStorageForbidden !== true) findings.push('secret-value non-persistence is not enforced');
    if (activation.monitoringMechanismVerified !== true || activation.monitorEvidenceRetrievalVerified !== true || activation.monitorRepairCapabilityVerified !== true) findings.push('activation does not prove executable monitor/read/repair capability');
    if (expectedRepository && monitor.targetRepository !== expectedRepository) findings.push(`monitor target ${monitor.targetRepository || '<missing>'} does not match ${expectedRepository}`);
    if (expectedBranch && monitor.developmentBranch !== expectedBranch) findings.push(`monitor branch ${monitor.developmentBranch || '<missing>'} does not match ${expectedBranch}`);
    if (!Array.isArray(monitor.allowedWorkflowOrCheckScope) || monitor.allowedWorkflowOrCheckScope.length === 0) findings.push('monitor workflow/check scope is empty');
  }

  if (TERMINAL_STATES.has(lifecycleState)) {
    if (!['disabled', 'resolved', 'blocked', 'expired'].includes(monitorState)) findings.push('terminal injection still has an active monitor state');
    if (monitorState !== 'disabled' && lifecycleState === 'completed') findings.push('completed injection monitor must be disabled');
    if (credential.enabled === true) findings.push('terminal injection still has an enabled injection credential');
  }

  return {
    ok: findings.length === 0,
    skipped:false,
    findings,
    state:lifecycleState || monitorState || 'unknown',
    targetRepository:monitor.targetRepository || null,
    developmentBranch:monitor.developmentBranch || null,
    expiresAt:expiresAt === null ? null : new Date(expiresAt).toISOString(),
  };
}

if (require.main === module) {
  const root = path.resolve(process.env.CRUCIBLE_PROJECT_ROOT || process.cwd());
  const result = verifyInjectionMonitor(root);
  if (result.skipped) {
    console.log('[The Crucible] Injection monitor check skipped: no injection prerequisite manifest is installed.');
  } else if (!result.ok) {
    console.error(`[The Crucible] Injection monitor verification failed:\n${result.findings.map((item) => `- ${item}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`[The Crucible] Injection monitor lifecycle verified (${result.state}) for ${result.targetRepository || 'recorded target'}${result.expiresAt ? ` through ${result.expiresAt}` : ''}.`);
  }
}

module.exports = { MANIFEST_PATH, MAX_LIFETIME_MS, loadManifest, verifyInjectionMonitor };

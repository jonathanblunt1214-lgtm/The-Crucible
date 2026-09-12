'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_OUTPUT_BYTES = 250_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_CONCURRENT_RUNS = 1;

const EXECUTION_TOOLS = Object.freeze({
  crucible_validate: {
    action: 'validate',
    description: 'Validate The Crucible configuration for the configured project.',
    mutating: false
  },
  crucible_precheck: {
    action: 'precheck',
    description: 'Run The Crucible pre-check against the configured project.',
    mutating: false
  },
  crucible_governance: {
    action: 'governance',
    description: 'Run The Crucible configuration and AI-conflict governance checks.',
    mutating: false
  },
  crucible_security: {
    action: 'security',
    description: 'Run the Security Gate. Findings can be copied into the project quarantine.',
    mutating: true
  },
  crucible_run: {
    action: 'run',
    description: 'Run the configured Crucible gate suite and project workload.',
    mutating: true
  },
  crucible_repair: {
    action: 'repair',
    description: 'Run The Crucible repair operation against the configured project.',
    mutating: true
  }
});

let activeRuns = 0;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredDirectory(env, variableName) {
  const configured = env[variableName];
  if (!configured) throw new Error(`${variableName} is required for Crucible execution tools.`);
  if (!path.isAbsolute(configured)) throw new Error(`${variableName} must be an absolute path.`);
  const resolved = fs.realpathSync(configured);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${variableName} must identify a directory.`);
  return resolved;
}

function executionConfiguration(env) {
  const coreRoot = configuredDirectory(env, 'CRUCIBLE_CORE_ROOT');
  const projectRoot = configuredDirectory(env, 'CRUCIBLE_PROJECT_ROOT');
  const cli = fs.realpathSync(path.join(coreRoot, 'src', 'cli.js'));
  const relativeCli = path.relative(coreRoot, cli);
  if (relativeCli.startsWith('..') || path.isAbsolute(relativeCli)) {
    throw new Error('The configured Crucible CLI resolves outside CRUCIBLE_CORE_ROOT.');
  }
  if (!fs.statSync(cli).isFile()) throw new Error('The configured Crucible CLI is not a file.');
  return { cli, projectRoot };
}

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const force = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 2_000);
  force.unref();
}

function runAllowedAction(action, { env = process.env, spawnProcess = spawn } = {}) {
  return new Promise((resolve) => {
    let configuration;
    try {
      configuration = executionConfiguration(env);
    } catch (error) {
      resolve({ ok: false, configurationError: error.message, action });
      return;
    }

    const maximum = positiveInteger(env.CRUCIBLE_MCP_MAX_CONCURRENT_RUNS, DEFAULT_MAX_CONCURRENT_RUNS);
    if (activeRuns >= maximum) {
      resolve({ ok: false, busy: true, action });
      return;
    }
    activeRuns += 1;

    const timeoutMs = positiveInteger(env.CRUCIBLE_MCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const childEnv = { ...env, CRUCIBLE_PROJECT_ROOT: configuration.projectRoot };
    delete childEnv.CRUCIBLE_MCP_BEARER_TOKEN;
    let child;
    try {
      child = spawnProcess(process.execPath, [configuration.cli, action], {
        cwd: configuration.projectRoot,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      activeRuns -= 1;
      resolve({ ok: false, exitCode: null, spawnError: error.message, action });
      return;
    }

    let stdout = '';
    let stderr = '';
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const capture = (target, chunk) => {
      if (truncated) return target;
      const text = chunk.toString('utf8');
      totalBytes += Buffer.byteLength(text);
      if (totalBytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        return `${target}\n[output truncated by Crucible MCP adapter]`;
      }
      return target + text;
    };

    child.stdout.on('data', (chunk) => { stdout = capture(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = capture(stderr, chunk); });

    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      activeRuns -= 1;
      clearTimeout(timer);
      resolve({ ...result, action, stdout, stderr, truncated, timedOut });
    };

    timer = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, timeoutMs);
    timer.unref();

    child.on('error', (error) => finish({ ok: false, exitCode: null, spawnError: error.message }));
    child.on('close', (code, signal) => finish({ ok: code === 0 && !timedOut, exitCode: code, signal }));
  });
}

function executionSummary(result) {
  if (result.configurationError) return `Configuration error: ${result.configurationError}`;
  if (result.busy) return 'The Crucible MCP adapter is already running its configured concurrency limit.';
  const lines = [
    `Action: ${result.action}`,
    `Exit code: ${result.exitCode === null ? 'unavailable' : result.exitCode}`
  ];
  if (result.signal) lines.push(`Signal: ${result.signal}`);
  if (result.timedOut) lines.push('Status: timed out');
  if (result.truncated) lines.push('Status: output truncated');
  if (result.spawnError) lines.push(`Startup error: ${result.spawnError}`);
  if (result.stdout && result.stdout.trim()) lines.push(`STDOUT:\n${result.stdout.trim()}`);
  if (result.stderr && result.stderr.trim()) lines.push(`STDERR:\n${result.stderr.trim()}`);
  return lines.join('\n\n');
}

module.exports = { EXECUTION_TOOLS, executionSummary, runAllowedAction };

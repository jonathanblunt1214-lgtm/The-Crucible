'use strict';

// Sandboxed toolchain execution, offered on the circulation bus.
//
// The experiment adapters live in the immune system, beside SecureCompilerWorker, because
// running a compiler is an immune capability: allow-listed absolute executable, no shell,
// bounded timeout, capped output, both streams content-addressed. The learning system needs
// them to run a controlled experiment, and a learning module importing an immune module
// directly is the organ-to-organ cabling fly-by-wire forbids.
//
// So they arrive here instead. An edge to circulation is the wire rather than the cable, which
// is the same reason failureCodes and providerCirculation sit on this bus: every organ may ask
// for a shared capability without that becoming a new direct connection between two organs.
//
// This module holds no policy. It resolves a toolchain and hands back an adapter; what gets
// measured, and whether a measurement satisfies a claim, is decided in the learning system.
const fs = require('node:fs');
const path = require('node:path');
const { JavaRuntimeAdapter, NodeRuntimeAdapter, JavaSemanticAdapter, TypeScriptSemanticAdapter } = require('./semanticAnalysis');

// Resolved from the environment rather than assumed at a fixed path, because the JDK lands
// somewhere different on a GitHub runner than in a container. A missing toolchain is reported
// by name here rather than as a failure inside a compiler invocation much later.
// A Windows JDK ships javac.exe and java.exe, so probing for extensionless names finds nothing
// and the toolchain is reported absent on a runner that has one. That is what happened: run
// 35150387996 failed five tests on all three windows-2022 legs with CRU-0050 "the java toolchain
// is unavailable on this runner", while every ubuntu and macOS leg passed. The JDK was there; the
// probe could not see it. PATH is searched as well as JAVA_HOME because a runner may ship a JDK
// without exporting JAVA_HOME, and searching it is strictly better than guessing at two POSIX
// directories that cannot exist on Windows anyway.
function executableIn(directory, base, platform) {
  const suffixes = platform === 'win32' ? ['.exe', '.bat', '.cmd', ''] : [''];
  for (const suffix of suffixes) {
    const candidate = path.join(directory, `${base}${suffix}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function javaToolchain(env = process.env, platform = process.platform) {
  const candidates = [];
  if (env.JAVA_HOME) candidates.push(path.join(env.JAVA_HOME, 'bin'));
  for (const entry of String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':')) {
    const trimmed = entry.trim();
    if (trimmed) candidates.push(trimmed);
  }
  if (platform !== 'win32') candidates.push('/usr/bin', '/usr/local/bin');
  for (const directory of candidates) {
    const javac = executableIn(directory, 'javac', platform);
    const java = executableIn(directory, 'java', platform);
    if (javac && java) return { javac, java, directory };
  }
  return null;
}

function javaRuntimeAdapter({ projectId, root, env = process.env }) {
  const toolchain = javaToolchain(env);
  if (!toolchain) return null;
  return new JavaRuntimeAdapter({ projectId, root, javacExecutable: toolchain.javac, javaExecutable: toolchain.java });
}

function javaStaticAdapter({ projectId, root, env = process.env }) {
  const toolchain = javaToolchain(env);
  if (!toolchain) return null;
  return new JavaSemanticAdapter({ projectId, root, javaExecutable: toolchain.java });
}

function nodeRuntimeAdapter({ projectId, root }) {
  return new NodeRuntimeAdapter({ projectId, root });
}

function typescriptStaticAdapter({ projectId, root }) {
  return new TypeScriptSemanticAdapter({ projectId, root });
}

module.exports = { javaToolchain, javaRuntimeAdapter, javaStaticAdapter, nodeRuntimeAdapter, typescriptStaticAdapter };

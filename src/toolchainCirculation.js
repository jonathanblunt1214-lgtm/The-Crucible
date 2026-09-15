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
function javaToolchain(env = process.env) {
  const candidates = [];
  if (env.JAVA_HOME) candidates.push(path.join(env.JAVA_HOME, 'bin'));
  candidates.push('/usr/bin', '/usr/local/bin');
  for (const directory of candidates) {
    const javac = path.join(directory, 'javac');
    const java = path.join(directory, 'java');
    if (fs.existsSync(javac) && fs.existsSync(java)) return { javac, java, directory };
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

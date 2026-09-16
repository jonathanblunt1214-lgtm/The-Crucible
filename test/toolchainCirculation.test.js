'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { javaToolchain } = require('../src/toolchainCirculation');

// Real directories with real files, because the defect was that a real file on disk was not
// seen. Stubbing fs here would have reproduced the bug as a pass.
function jdk(t, { bin = 'bin', names }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-jdk-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const binary = path.join(home, bin);
  fs.mkdirSync(binary, { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(binary, name), '');
  return { home, binary };
}

// Regression, 2026-09-16. Hosted run 35150387996 failed five tests on all three windows-2022
// legs with CRU-0050 "the java toolchain is unavailable on this runner", while every ubuntu and
// macOS leg passed. The runner had a JDK. The resolver probed for extensionless `javac` and
// `java`, which on Windows are `javac.exe` and `java.exe`, so it never found either and reported
// the toolchain absent.
test('a Windows JDK is found, because its executables carry an .exe suffix', (t) => {
  const { home, binary } = jdk(t, { names: ['javac.exe', 'java.exe'] });

  const found = javaToolchain({ JAVA_HOME: home }, 'win32');
  assert.notEqual(found, null, 'the JDK on disk must be found');
  assert.equal(found.javac, path.join(binary, 'javac.exe'));
  assert.equal(found.java, path.join(binary, 'java.exe'));

  // The exact shape of the defect: the same JDK, probed the way it used to be.
  assert.equal(fs.existsSync(path.join(binary, 'javac')), false, 'there is no extensionless javac to find');
});

test('a POSIX JDK is found unchanged, and no .exe is invented for it', (t) => {
  const { home, binary } = jdk(t, { names: ['javac', 'java'] });

  const found = javaToolchain({ JAVA_HOME: home }, 'linux');
  assert.notEqual(found, null);
  assert.equal(found.javac, path.join(binary, 'javac'));
  assert.equal(found.java, path.join(binary, 'java'));
});

test('PATH is searched too, because a runner may ship a JDK without exporting JAVA_HOME', (t) => {
  const { binary } = jdk(t, { names: ['javac.exe', 'java.exe'] });

  const found = javaToolchain({ Path: `C:\\nowhere;${binary}` }, 'win32');
  assert.notEqual(found, null, 'the Windows PATH variable is spelled Path and split on semicolons');
  assert.equal(found.directory, binary);

  const posix = jdk(t, { names: ['javac', 'java'] });
  assert.equal(javaToolchain({ PATH: `/nowhere:${posix.binary}` }, 'linux').directory, posix.binary);
});

test('a half-present toolchain is absent, because a compiler without a runtime cannot run an experiment', (t) => {
  const { home } = jdk(t, { names: ['javac.exe'] });
  assert.equal(javaToolchain({ JAVA_HOME: home, Path: '' }, 'win32'), null);
});

test('the POSIX fallbacks are not consulted on Windows, where they cannot exist', () => {
  // Nothing declared and nothing on PATH: absent, rather than resolved from /usr/bin, which is
  // what the old unconditional fallback list would have reached for on a platform that has no
  // such directory. An absent toolchain has to stay absent so CRU-0050 means what it says.
  assert.equal(javaToolchain({ JAVA_HOME: '', Path: '' }, 'win32'), null);
  assert.equal(javaToolchain({}, 'win32'), null);
});

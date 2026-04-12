const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { bundledBinarySubpath, getTargetForHost, resolveBinary } = require('../lib/targets.js');

test('maps linux musl hosts to the musl package', () => {
  const target = getTargetForHost({
    platform: 'linux',
    arch: 'x64',
    libc: 'musl',
  });

  assert.equal(target?.rustTarget, 'x86_64-unknown-linux-musl');
});

test('returns undefined for unsupported platforms', () => {
  assert.equal(
    getTargetForHost({
      platform: 'freebsd',
      arch: 'x64',
    }),
    undefined,
  );
});

test('resolves a bundled package binary', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schemafy-npm-'));

  try {
    const packageRoot = path.join(tempRoot, 'npm', 'schemafy');
    const libDir = path.join(packageRoot, 'lib');
    const binaryPath = path.join(packageRoot, bundledBinarySubpath({
      rustTarget: 'x86_64-unknown-linux-gnu',
      binaryName: 'schemafy',
    }));

    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');

    const resolution = resolveBinary({
      baseDir: libDir,
      host: {
        platform: 'linux',
        arch: 'x64',
        libc: 'glibc',
      },
      includeLocalBuilds: false,
    });

    assert.equal(resolution.source, 'bundledPackage');
    assert.equal(fs.realpathSync(resolution.binaryPath), fs.realpathSync(binaryPath));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('falls back to a local cargo build inside the repository checkout', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schemafy-npm-'));

  try {
    const libDir = path.join(tempRoot, 'npm', 'schemafy', 'lib');
    const cargoBinary = path.join(tempRoot, 'target', 'debug', 'schemafy');

    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(path.dirname(cargoBinary), { recursive: true });
    fs.writeFileSync(cargoBinary, '#!/bin/sh\nexit 0\n');

    const resolution = resolveBinary({
      baseDir: libDir,
      host: {
        platform: 'darwin',
        arch: 'arm64',
      },
    });

    assert.equal(resolution.source, 'localBuild');
    assert.equal(resolution.binaryPath, cargoBinary);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

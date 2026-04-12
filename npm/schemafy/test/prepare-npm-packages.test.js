const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { binarySubpath, githubArtifactSubpath, TARGETS } = require('../lib/targets.js');
const {
  createPlatformManifest,
  createRootManifest,
  stageBinaries,
} = require('../../../scripts/prepare-npm-packages.js');

test('generates publish-safe bin paths', () => {
  const rootManifest = createRootManifest('1.2.3');
  assert.equal(rootManifest.bin.schemafy, 'bin/schemafy.js');

  for (const target of TARGETS) {
    const manifest = createPlatformManifest('1.2.3', target);
    assert.equal(manifest.bin.schemafy, binarySubpath(target));
    assert.equal(manifest.bin.schemafy.startsWith('./'), false);
  }
});

test('stages binaries from a GitHub Actions artifact download layout', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schemafy-stage-'));
  const artifactsDir = path.join(tempRoot, 'artifacts');

  try {
    for (const target of TARGETS) {
      const sourcePath = path.join(artifactsDir, githubArtifactSubpath(target));
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, target.binaryName);
    }

    stageBinaries(artifactsDir, tempRoot);

    for (const target of TARGETS) {
      const destinationPath = path.join(
        tempRoot,
        'npm',
        target.packageDirectoryName,
        'bin',
        target.binaryName,
      );
      assert.equal(fs.readFileSync(destinationPath, 'utf8'), target.binaryName);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('stages binaries from a flattened GitHub artifact download layout', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schemafy-stage-'));
  const artifactsDir = path.join(tempRoot, 'artifacts');

  try {
    for (const target of TARGETS) {
      const sourcePath = path.join(
        artifactsDir,
        `schemafy-${target.rustTarget}`,
        target.binaryName,
      );
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, target.binaryName);
    }

    stageBinaries(artifactsDir, tempRoot);

    for (const target of TARGETS) {
      const destinationPath = path.join(
        tempRoot,
        'npm',
        target.packageDirectoryName,
        'bin',
        target.binaryName,
      );
      assert.equal(fs.readFileSync(destinationPath, 'utf8'), target.binaryName);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

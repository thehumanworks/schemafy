const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { TARGETS } = require('../lib/targets.js');
const {
  PUBLISH_WORKSPACES,
  verifyPublishablePackages,
} = require('../../../scripts/publish-npm-packages.js');

test('publishes platform packages before the launcher package', () => {
  assert.equal(PUBLISH_WORKSPACES.length, TARGETS.length + 1);
  assert.equal(PUBLISH_WORKSPACES.at(-1), 'npm/schemafy');
});

test('reports missing staged platform binaries before publish', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schemafy-publish-'));

  try {
    const launcherPath = path.join(tempRoot, 'npm', 'schemafy', 'bin', 'schemafy.js');
    fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
    fs.writeFileSync(launcherPath, '#!/usr/bin/env node\n');

    assert.throws(
      () => verifyPublishablePackages(tempRoot),
      /Build all target binaries into dist\/npm and run `npm run npm:stage` before publishing\./,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('accepts a fully staged publish layout', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schemafy-publish-'));

  try {
    const launcherPath = path.join(tempRoot, 'npm', 'schemafy', 'bin', 'schemafy.js');
    fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
    fs.writeFileSync(launcherPath, '#!/usr/bin/env node\n');

    for (const target of TARGETS) {
      const binaryPath = path.join(
        tempRoot,
        'npm',
        target.packageDirectoryName,
        'bin',
        target.binaryName,
      );
      fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
      fs.writeFileSync(binaryPath, '');
    }

    assert.doesNotThrow(() => verifyPublishablePackages(tempRoot));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

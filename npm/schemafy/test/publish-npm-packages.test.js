const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { githubArtifactSubpath, TARGETS } = require('../lib/targets.js');
const {
  PUBLISH_WORKSPACES,
  parseCliArgs,
  preparePublishablePackages,
  verifyPublishablePackages,
} = require('../../../scripts/publish-npm-packages.js');

test('publishes platform packages before the launcher package', () => {
  assert.equal(PUBLISH_WORKSPACES.length, TARGETS.length + 1);
  assert.equal(PUBLISH_WORKSPACES.at(-1), 'npm/schemafy');
});

test('parses an explicit GitHub run id flag', () => {
  const { npmArgs, publishOptions } = parseCliArgs([
    '--github-run-id',
    '24308698750',
    '--dry-run',
  ]);

  assert.deepEqual(npmArgs, ['--dry-run']);
  assert.equal(publishOptions.githubRunId, '24308698750');
});

test('treats a leading bare numeric arg as the GitHub run id', () => {
  const { npmArgs, publishOptions } = parseCliArgs([
    '24308698750',
    '--dry-run',
  ]);

  assert.deepEqual(npmArgs, ['--dry-run']);
  assert.equal(publishOptions.githubRunId, '24308698750');
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

test('hydrates missing staged binaries from a GitHub artifact directory', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schemafy-publish-'));
  const artifactsDir = path.join(tempRoot, 'artifacts');

  try {
    const launcherPath = path.join(tempRoot, 'npm', 'schemafy', 'bin', 'schemafy.js');
    fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
    fs.writeFileSync(launcherPath, '#!/usr/bin/env node\n');

    for (const target of TARGETS) {
      const artifactPath = path.join(artifactsDir, githubArtifactSubpath(target));
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.writeFileSync(artifactPath, target.packageName);
    }

    assert.doesNotThrow(() =>
      preparePublishablePackages(
        {
          artifactsDir,
        },
        tempRoot,
      ),
    );

    for (const target of TARGETS) {
      const binaryPath = path.join(
        tempRoot,
        'npm',
        target.packageDirectoryName,
        'bin',
        target.binaryName,
      );
      assert.equal(fs.readFileSync(binaryPath, 'utf8'), target.packageName);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('downloads missing staged binaries from GitHub artifacts for the current commit', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schemafy-publish-'));
  const calls = [];

  try {
    const launcherPath = path.join(tempRoot, 'npm', 'schemafy', 'bin', 'schemafy.js');
    fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
    fs.writeFileSync(launcherPath, '#!/usr/bin/env node\n');

    const execFileSync = (command, args) => {
      calls.push([command, args]);

      if (command === 'git' && args[0] === 'config') {
        return 'https://github.com/thehumanworks/schemafy.git\n';
      }

      if (command === 'git' && args[0] === 'rev-parse') {
        return 'abc123\n';
      }

      if (command === 'gh' && args[0] === 'run' && args[1] === 'list') {
        return JSON.stringify([{ databaseId: 4242 }]);
      }

      if (command === 'gh' && args[0] === 'run' && args[1] === 'download') {
        const outputDir = args[args.indexOf('--dir') + 1];
        for (const target of TARGETS) {
          const artifactPath = path.join(outputDir, githubArtifactSubpath(target));
          fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
          fs.writeFileSync(artifactPath, target.packageName);
        }
        return '';
      }

      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    };

    assert.doesNotThrow(() =>
      preparePublishablePackages(
        {},
        tempRoot,
        {
          execFileSync,
        },
      ),
    );

    assert.deepEqual(
      calls.filter(([command]) => command === 'gh').map(([, args]) => args.slice(0, 2)),
      [
        ['run', 'list'],
        ['run', 'download'],
      ],
    );

    for (const target of TARGETS) {
      const binaryPath = path.join(
        tempRoot,
        'npm',
        target.packageDirectoryName,
        'bin',
        target.binaryName,
      );
      assert.equal(fs.readFileSync(binaryPath, 'utf8'), target.packageName);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

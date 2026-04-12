#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  ROOT_PACKAGE_NAME,
  TARGETS,
  artifactSubpath,
  binarySubpath,
  githubArtifactSubpath,
} = require('../npm/schemafy/lib/targets.js');

const repoRoot = path.resolve(__dirname, '..');
const cargoTomlPath = path.join(repoRoot, 'Cargo.toml');

function main() {
  const version = readCargoVersion(cargoTomlPath);
  writeJson(
    path.join(repoRoot, 'npm', 'schemafy', 'package.json'),
    createRootManifest(version),
  );

  for (const target of TARGETS) {
    writeJson(
      path.join(repoRoot, 'npm', target.packageDirectoryName, 'package.json'),
      createPlatformManifest(version, target),
    );
  }

  const artifactsDir = resolveArtifactsDir();
  if (artifactsDir) {
    stageBinaries(artifactsDir);
    console.log(`Synced npm manifests to ${version} and staged binaries from ${artifactsDir}.`);
    return;
  }

  console.log(`Synced npm manifests to ${version}.`);
}

function resolveArtifactsDir() {
  const flagIndex = process.argv.indexOf('--artifacts-dir');
  let providedPath = process.env.SCHEMAFY_NPM_ARTIFACTS_DIR;

  if (flagIndex !== -1) {
    providedPath = process.argv[flagIndex + 1];
    if (!providedPath) {
      throw new Error('missing value for --artifacts-dir');
    }
  }

  return providedPath ? path.resolve(repoRoot, providedPath) : null;
}

function readCargoVersion(filePath) {
  const cargoToml = fs.readFileSync(filePath, 'utf8');
  const packageSection = cargoToml.match(/\[package\]([\s\S]*?)(?:\n\[|$)/);
  if (!packageSection) {
    throw new Error(`failed to find [package] section in ${filePath}`);
  }

  const versionMatch = packageSection[1].match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!versionMatch) {
    throw new Error(`failed to find package version in ${filePath}`);
  }

  return versionMatch[1];
}

function createRootManifest(version) {
  return {
    name: ROOT_PACKAGE_NAME,
    version,
    description: 'Cross-platform npm launcher for the schemafy CLI.',
    publishConfig: {
      access: 'public',
    },
    os: [...new Set(TARGETS.map((target) => target.os))],
    cpu: [...new Set(TARGETS.map((target) => target.cpu))],
    engines: {
      node: '>=18',
    },
    bin: {
      schemafy: 'bin/schemafy.js',
    },
    files: ['bin', 'lib', 'scripts'],
    scripts: {
      postinstall: 'node ./scripts/postinstall.js',
    },
    optionalDependencies: Object.fromEntries(
      TARGETS.map((target) => [target.packageName, version]),
    ),
  };
}

function createPlatformManifest(version, target) {
  const manifest = {
    name: target.packageName,
    version,
    description: `${target.displayName} binary for the schemafy CLI.`,
    publishConfig: {
      access: 'public',
    },
    os: [target.os],
    cpu: [target.cpu],
    files: [binarySubpath(target)],
    bin: {
      schemafy: binarySubpath(target),
    },
  };

  if (target.libc) {
    manifest.libc = [target.libc];
  }

  return manifest;
}

function stageBinaries(artifactsDir, rootDir = repoRoot) {
  const missingArtifacts = [];

  for (const target of TARGETS) {
    const sourcePath = resolveArtifactSourcePath(artifactsDir, target);
    if (!fs.existsSync(sourcePath)) {
      missingArtifacts.push(`${target.packageName}: ${sourcePath}`);
    }
  }

  if (missingArtifacts.length > 0) {
    throw new Error(
      `missing staged binaries:\n${missingArtifacts.map((entry) => `  - ${entry}`).join('\n')}`,
    );
  }

  for (const target of TARGETS) {
    const sourcePath = resolveArtifactSourcePath(artifactsDir, target);
    const destinationPath = path.join(
      rootDir,
      'npm',
      target.packageDirectoryName,
      'bin',
      target.binaryName,
    );

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    if (!target.binaryName.endsWith('.exe')) {
      fs.chmodSync(destinationPath, 0o755);
    }
  }
}

function resolveArtifactSourcePath(artifactsDir, target) {
  const localArtifactPath = path.join(artifactsDir, artifactSubpath(target));
  if (fs.existsSync(localArtifactPath)) {
    return localArtifactPath;
  }

  return path.join(artifactsDir, githubArtifactSubpath(target));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  createPlatformManifest,
  createRootManifest,
  main,
  readCargoVersion,
  resolveArtifactSourcePath,
  resolveArtifactsDir,
  stageBinaries,
  writeJson,
};

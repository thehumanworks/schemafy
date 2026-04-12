const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCOPE = '@nothumanwork';
const ROOT_PACKAGE_NAME = `${SCOPE}/schemafy`;

const TARGETS = [
  {
    id: 'darwin-arm64',
    packageDirectoryName: 'schemafy-darwin-arm64',
    packageName: `${SCOPE}/schemafy-darwin-arm64`,
    rustTarget: 'aarch64-apple-darwin',
    os: 'darwin',
    cpu: 'arm64',
    displayName: 'macOS arm64',
    binaryName: 'schemafy',
  },
  {
    id: 'darwin-x64',
    packageDirectoryName: 'schemafy-darwin-x64',
    packageName: `${SCOPE}/schemafy-darwin-x64`,
    rustTarget: 'x86_64-apple-darwin',
    os: 'darwin',
    cpu: 'x64',
    displayName: 'macOS x64',
    binaryName: 'schemafy',
  },
  {
    id: 'linux-arm64-gnu',
    packageDirectoryName: 'schemafy-linux-arm64-gnu',
    packageName: `${SCOPE}/schemafy-linux-arm64-gnu`,
    rustTarget: 'aarch64-unknown-linux-gnu',
    os: 'linux',
    cpu: 'arm64',
    libc: 'glibc',
    displayName: 'Linux arm64 (glibc)',
    binaryName: 'schemafy',
  },
  {
    id: 'linux-arm64-musl',
    packageDirectoryName: 'schemafy-linux-arm64-musl',
    packageName: `${SCOPE}/schemafy-linux-arm64-musl`,
    rustTarget: 'aarch64-unknown-linux-musl',
    os: 'linux',
    cpu: 'arm64',
    libc: 'musl',
    displayName: 'Linux arm64 (musl)',
    binaryName: 'schemafy',
  },
  {
    id: 'linux-x64-gnu',
    packageDirectoryName: 'schemafy-linux-x64-gnu',
    packageName: `${SCOPE}/schemafy-linux-x64-gnu`,
    rustTarget: 'x86_64-unknown-linux-gnu',
    os: 'linux',
    cpu: 'x64',
    libc: 'glibc',
    displayName: 'Linux x64 (glibc)',
    binaryName: 'schemafy',
  },
  {
    id: 'linux-x64-musl',
    packageDirectoryName: 'schemafy-linux-x64-musl',
    packageName: `${SCOPE}/schemafy-linux-x64-musl`,
    rustTarget: 'x86_64-unknown-linux-musl',
    os: 'linux',
    cpu: 'x64',
    libc: 'musl',
    displayName: 'Linux x64 (musl)',
    binaryName: 'schemafy',
  },
  {
    id: 'win32-arm64-msvc',
    packageDirectoryName: 'schemafy-win32-arm64-msvc',
    packageName: `${SCOPE}/schemafy-win32-arm64-msvc`,
    rustTarget: 'aarch64-pc-windows-msvc',
    os: 'win32',
    cpu: 'arm64',
    displayName: 'Windows arm64',
    binaryName: 'schemafy.exe',
  },
  {
    id: 'win32-x64-msvc',
    packageDirectoryName: 'schemafy-win32-x64-msvc',
    packageName: `${SCOPE}/schemafy-win32-x64-msvc`,
    rustTarget: 'x86_64-pc-windows-msvc',
    os: 'win32',
    cpu: 'x64',
    displayName: 'Windows x64',
    binaryName: 'schemafy.exe',
  },
];

function normalizeLibc(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  return normalized === 'glibc' || normalized === 'musl' ? normalized : undefined;
}

function parseLibcOutput(output) {
  if (!output) {
    return undefined;
  }

  if (/musl/i.test(output)) {
    return 'musl';
  }

  if (/glibc|gnu libc|gnu c library/i.test(output)) {
    return 'glibc';
  }

  return undefined;
}

function detectLibc() {
  const envLibc = normalizeLibc(process.env.npm_config_libc || process.env.LIBC);
  if (envLibc) {
    return envLibc;
  }

  if (typeof process.report?.getReport === 'function') {
    try {
      const report = process.report.getReport();
      if (report?.header?.glibcVersionRuntime) {
        return 'glibc';
      }
    } catch {
      // Ignore and continue to other detection mechanisms.
    }
  }

  if (fs.existsSync('/etc/alpine-release')) {
    return 'musl';
  }

  try {
    return parseLibcOutput(
      execFileSync('ldd', ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    return parseLibcOutput(`${stdout}\n${stderr}`);
  }
}

function detectHost() {
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;

  return {
    platform,
    arch,
    libc: platform === 'linux' ? detectLibc() : undefined,
  };
}

function binarySubpath(target) {
  return path.posix.join('bin', target.binaryName);
}

function artifactSubpath(target) {
  return path.join(target.rustTarget, target.binaryName);
}

function githubArtifactName(target) {
  return `schemafy-${target.rustTarget}`;
}

function githubArtifactSubpath(target) {
  return path.join(
    githubArtifactName(target),
    'target',
    target.rustTarget,
    'release',
    target.binaryName,
  );
}

function getTargetForHost(host = detectHost()) {
  return TARGETS.find((target) => {
    if (target.os !== host.platform || target.cpu !== host.arch) {
      return false;
    }

    if (target.libc) {
      return target.libc === host.libc;
    }

    return true;
  });
}

function resolveBinary(options = {}) {
  const baseDir = options.baseDir || __dirname;
  const host = options.host || detectHost();
  const includeLocalBuilds = options.includeLocalBuilds !== false;
  const target = getTargetForHost(host);
  const checkedPaths = [];

  if (!target) {
    return {
      host,
      target: null,
      binaryPath: null,
      checkedPaths,
      source: null,
    };
  }

  const packageRoot = path.resolve(baseDir, '..');
  const dependencySpecifier = `${target.packageName}/${binarySubpath(target)}`;

  try {
    const binaryPath = require.resolve(dependencySpecifier, { paths: [packageRoot] });
    return {
      host,
      target,
      binaryPath,
      checkedPaths,
      source: 'optionalDependency',
    };
  } catch {
    // Fall through to the local build lookup.
  }

  if (includeLocalBuilds) {
    const repoRoot = path.resolve(baseDir, '..', '..', '..');
    const localCandidates = [
      path.join(repoRoot, 'target', 'release', target.binaryName),
      path.join(repoRoot, 'target', 'debug', target.binaryName),
    ];

    for (const candidate of localCandidates) {
      checkedPaths.push(candidate);
      if (fs.existsSync(candidate)) {
        return {
          host,
          target,
          binaryPath: candidate,
          checkedPaths,
          source: 'localBuild',
        };
      }
    }
  }

  return {
    host,
    target,
    binaryPath: null,
    checkedPaths,
    source: null,
  };
}

function formatHost(host) {
  const parts = [host.platform, host.arch];
  if (host.libc) {
    parts.push(host.libc);
  }
  return parts.join('/');
}

function formatMissingBinaryError(resolution) {
  if (!resolution.target) {
    const supportedTargets = TARGETS.map((target) => {
      const libcSuffix = target.libc ? `/${target.libc}` : '';
      return `  - ${target.os}/${target.cpu}${libcSuffix} -> ${target.packageName}`;
    }).join('\n');

    return [
      `${ROOT_PACKAGE_NAME} does not currently publish a binary for ${formatHost(resolution.host)}.`,
      'Supported targets:',
      supportedTargets,
    ].join('\n');
  }

  const lines = [
    `${ROOT_PACKAGE_NAME} could not find a binary for ${formatHost(resolution.host)}.`,
    `Expected optional dependency: ${resolution.target.packageName}.`,
    'If you installed from npm, make sure optional dependencies are enabled.',
    'If you are running from a checkout, build the Rust CLI first with `cargo build`.',
  ];

  if (resolution.checkedPaths.length > 0) {
    lines.push('Checked local build paths:');
    for (const candidate of resolution.checkedPaths) {
      lines.push(`  - ${candidate}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  ROOT_PACKAGE_NAME,
  TARGETS,
  artifactSubpath,
  binarySubpath,
  detectHost,
  detectLibc,
  formatMissingBinaryError,
  getTargetForHost,
  githubArtifactName,
  githubArtifactSubpath,
  resolveBinary,
};

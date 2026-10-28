import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

// A fresh, Linux-targeted dependency installation is used. Never upload the
// workspace or copy the Windows development node_modules into an HTTP function.
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const stagingParent = join(root, '.local', 'http-function');
await mkdir(stagingParent, { recursive: true });
const target = await mkdtemp(join(stagingParent, 'campusflow-api-'));
const sourceLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
if (sourceLock.lockfileVersion !== 3) throw new Error('Expected a version 3 npm lockfile');

const runtimePackages = [
  '@fastify/cookie',
  '@fastify/rate-limit',
  '@fastify/static',
  'dotenv',
  'fastify',
  'pg',
];
const dependencies = Object.fromEntries(
  runtimePackages.map((name) => {
    const version = sourceLock.packages[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`Missing locked runtime dependency: ${name}`);
    return [name, version];
  }),
);
const runtimePackage = {
  name: 'campusflow-http-runtime',
  version: '0.1.0',
  private: true,
  type: 'module',
  engines: { node: '>=22.12.0' },
  dependencies,
};
const packages = {
  '': {
    name: runtimePackage.name,
    version: runtimePackage.version,
    dependencies,
    engines: runtimePackage.engines,
  },
};

function lockedDependency(from, name) {
  const segments = from.split('/');
  while (segments.length) {
    if (segments.at(-1) !== 'node_modules') {
      const candidate = [...segments, 'node_modules', name].join('/');
      if (sourceLock.packages[candidate]) return candidate;
    }
    segments.pop();
  }
  const candidate = `node_modules/${name}`;
  return sourceLock.packages[candidate] ? candidate : undefined;
}

function includeLockedPackage(path) {
  if (packages[path]) return;
  const entry = structuredClone(sourceLock.packages[path]);
  if (!entry || entry.link)
    throw new Error(`Runtime dependency is not a locked registry package: ${path}`);
  delete entry.dev;
  delete entry.devOptional;
  packages[path] = entry;
  const required = { ...entry.dependencies };
  for (const [name] of Object.entries(entry.peerDependencies ?? {})) {
    if (!entry.peerDependenciesMeta?.[name]?.optional)
      required[name] = entry.peerDependencies[name];
  }
  for (const name of Object.keys({ ...required, ...entry.optionalDependencies })) {
    const resolved = lockedDependency(path, name);
    if (resolved) includeLockedPackage(resolved);
    else if (Object.hasOwn(required, name))
      throw new Error(`Missing dependency ${name} of ${path}`);
  }
}
for (const name of runtimePackages) includeLockedPackage(`node_modules/${name}`);

await writeFile(join(target, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);
await writeFile(
  join(target, 'package-lock.json'),
  `${JSON.stringify({ name: runtimePackage.name, version: runtimePackage.version, lockfileVersion: 3, requires: true, packages }, null, 2)}\n`,
);

function runNode(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} exited with status ${result.status}`);
}

const npmCandidates = [
  process.env.npm_execpath,
  join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
].filter(Boolean);
const npmCli = npmCandidates.find((path) => existsSync(path) && path.endsWith('npm-cli.js'));
if (!npmCli) {
  throw new Error(
    'Cannot locate npm-cli.js. Run with npm exec -- node cloudbase/deployment/prepare-http-function.mjs',
  );
}
runNode('build.mjs', [], join(root, 'services/api'));
runNode(
  npmCli,
  [
    'ci',
    '--omit=dev',
    '--omit=optional',
    '--ignore-scripts',
    '--os=linux',
    '--cpu=x64',
    '--no-audit',
    '--no-fund',
  ],
  target,
);

await mkdir(join(target, 'services/api/dist'), { recursive: true });
await copyFile(
  join(root, 'services/api/dist/server.js'),
  join(target, 'services/api/dist/server.js'),
);
const bootstrap = (
  await readFile(join(root, 'cloudbase/deployment/scf_bootstrap'), 'utf8')
).replaceAll('\r\n', '\n');
await writeFile(join(target, 'scf_bootstrap'), bootstrap, { mode: 0o755 });
await chmod(join(target, 'scf_bootstrap'), 0o755);

const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(target, path).replaceAll('\\', '/');
    if (name === 'node_modules/.bin') continue;
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Symlink requires review: ${name}`);
    if (entry.isDirectory()) {
      if (/(^|\/)(?:\.git|\.data|source-documents|pglite)$/.test(name))
        throw new Error(`Forbidden directory: ${name}`);
      await collect(path);
    } else {
      if (/(^|\/)\.env(?:\.|$)|\.(?:node|dll|exe|so|dylib|wasm)$/i.test(name)) {
        throw new Error(`Secret or platform-specific file requires review: ${name}`);
      }
      const data = await readFile(path);
      files.push({ name, data, mode: name === 'scf_bootstrap' ? 0o100755 : 0o100644 });
    }
  }
}
await collect(target);
files.sort((a, b) => a.name.localeCompare(b.name));
if (files.some(({ name }) => name.includes('@electric-sql/')))
  throw new Error('PGlite must not be packaged');

// Write a standard ZIP using Unix file attributes, even when built on Windows.
// In particular scf_bootstrap must retain executable mode after Linux extraction.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (data) => {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunks = [];
const central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(file.name, 'utf8');
  const compressed = deflateRawSync(file.data);
  const crc = crc32(file.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0x21, 12); // 1980-01-01, deterministic archive timestamp.
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(file.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  chunks.push(local, name, compressed);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE(0x0314, 4); // ZIP 2.0, Unix host.
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x800, 8);
  record.writeUInt16LE(8, 10);
  record.writeUInt16LE(0x21, 14);
  record.writeUInt32LE(crc, 16);
  record.writeUInt32LE(compressed.length, 20);
  record.writeUInt32LE(file.data.length, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt32LE((file.mode << 16) >>> 0, 38);
  record.writeUInt32LE(offset, 42);
  central.push(record, name);
  offset += local.length + name.length + compressed.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...chunks, directory, end]);
if (archive.length > 50 * 1024 * 1024)
  throw new Error('Archive exceeds the 50 MiB local review limit');
const archivePath = `${target}.zip`;
const manifestPath = `${target}.manifest.json`;
await writeFile(archivePath, archive);
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      runtime: 'Nodejs24.11',
      platform: 'linux-x64',
      createdAt: new Date().toISOString(),
      archiveSha256: createHash('sha256').update(archive).digest('hex'),
      files: files.map(({ name, data, mode }) => ({
        path: name,
        bytes: data.length,
        mode: mode.toString(8),
        sha256: createHash('sha256').update(data).digest('hex'),
      })),
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify({
    source: target,
    archive: archivePath,
    manifest: manifestPath,
    fileCount: files.length,
    bytes: archive.length,
    runtime: 'Nodejs24.11',
  }),
);

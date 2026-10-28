import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CloudBase CLI source uploads do not honor .gitignore or .dockerignore.
// Assemble only the files the API Dockerfile needs; never upload the workspace.
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const stagingParent = join(root, '.local', 'cloudrun');
await mkdir(stagingParent, { recursive: true });
const target = await mkdtemp(join(stagingParent, 'source-'));
const manifest = [];

async function copy(sourcePath, targetPath = sourcePath) {
  const source = join(root, sourcePath);
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular file: ${sourcePath}`);
  const destination = join(target, targetPath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const data = await readFile(destination);
  manifest.push({
    path: targetPath.replaceAll('\\', '/'),
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
}

async function copySources(directory, allowedExtensions) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const sourcePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not deployable: ${sourcePath}`);
    if (entry.isDirectory()) await copySources(sourcePath, allowedExtensions);
    else if (allowedExtensions.has(extname(entry.name))) await copy(sourcePath);
    else throw new Error(`Review unsupported source file before deploying: ${sourcePath}`);
  }
}

for (const path of [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  '.dockerignore',
  'apps/web/package.json',
  'services/api/package.json',
  'services/api/build.mjs',
  'packages/shared/package.json',
])
  await copy(path);
await copy('cloudbase/deployment/Dockerfile', 'Dockerfile');
await copySources('services/api/src', new Set(['.ts']));
await copySources('packages/shared/src', new Set(['.ts']));
await copySources('cloudbase/migrations', new Set(['.sql']));
manifest.sort((a, b) => a.path.localeCompare(b.path));
const manifestPath = `${target}.manifest.json`;
await writeFile(
  manifestPath,
  `${JSON.stringify({ createdAt: new Date().toISOString(), files: manifest }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    source: target,
    manifest: manifestPath,
    fileCount: manifest.length,
    workspaceRelativeSource: relative(root, target),
  }),
);

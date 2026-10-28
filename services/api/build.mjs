import { build } from 'esbuild';
await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [
    '@electric-sql/pglite',
    '@cloudbase/node-sdk',
    '@fastify/cookie',
    '@fastify/rate-limit',
    '@fastify/static',
    'fastify',
    'pg',
    'dotenv',
    'jose',
  ],
});

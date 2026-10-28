import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { createApp } from './app.js';
import { projectRoot } from './db.js';
dotenv.config({ path: resolve(projectRoot, '.env'), quiet: true });
const app = await createApp({
  logger: false,
  dataDir: process.env.DATA_DIR ? resolve(projectRoot, process.env.DATA_DIR) : undefined,
});
const frontend = resolve(projectRoot, 'apps/web/dist');
if (existsSync(frontend)) {
  await app.register(fastifyStatic, { root: frontend, prefix: '/' });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/')
      ? reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在。' } })
      : reply.sendFile('index.html'),
  );
}
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(
  `CampusFlow API listening on http://${process.env.HOST ?? '127.0.0.1'}:${port} (${app.db.kind}).`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });

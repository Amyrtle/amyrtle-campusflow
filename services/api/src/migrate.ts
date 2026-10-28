import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDatabase, projectRoot } from './db.js';
dotenv.config({ path: resolve(projectRoot, '.env'), quiet: true });
const db = await createDatabase({
  migrate: true,
  dataDir: process.env.DATA_DIR ? resolve(projectRoot, process.env.DATA_DIR) : undefined,
});
try {
  if (db.kind === 'postgres')
    await db.execute(
      await readFile(resolve(projectRoot, 'cloudbase/migrations/20261025000001_rls.sql'), 'utf8'),
    );
  console.log(`Schema migration applied to ${db.kind}.`);
} finally {
  await db.close();
}

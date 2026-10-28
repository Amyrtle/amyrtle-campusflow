import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDatabase, projectRoot } from '../src/db.js';

// Isolated PostgreSQL engine check; no cloud connection or real records.
if (process.env.DATABASE_URL)
  throw new Error('Unset DATABASE_URL before running isolated RLS verification');
const db = await createDatabase({ dataDir: 'memory://' });
try {
  await db.execute('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const policy = await readFile(resolve(projectRoot, 'cloudbase/migrations/20261025000001_rls.sql'), 'utf8');
  await db.execute(policy);
  await db.execute(policy); // Rerunning the migration must be safe.
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  await db.query(
    'INSERT INTO users_profile(id,email,display_name,cloudbase_subject) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
    [
      userId,
      'rls-one@example.test',
      'RLS test one',
      'cloud-sub-one',
      otherUserId,
      'rls-two@example.test',
      'RLS test two',
      'cloud-sub-two',
    ],
  );
  await db.query('INSERT INTO organizations(id,name,created_by) VALUES($1,$2,$3),($4,$5,$6)', [
    orgId,
    'RLS org one',
    userId,
    otherOrgId,
    'RLS org two',
    otherUserId,
  ]);
  await db.query(
    "INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'Owner'),($3,$4,'Owner')",
    [orgId, userId, otherOrgId, otherUserId],
  );
  const ownOrganizations = await db.transaction(async (tx) => {
    await tx.query('SET LOCAL ROLE authenticated');
    await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: 'cloud-sub-one' }),
    ]);
    return (await tx.query('SELECT id FROM organizations')).rows;
  });
  assert.deepEqual(
    ownOrganizations.map((row) => row.id),
    [orgId],
  );
  const ownProfile = await db.transaction(async (tx) => {
    await tx.query('SET LOCAL ROLE authenticated');
    await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: 'cloud-sub-one' }),
    ]);
    return (await tx.query('SELECT id,email,display_name FROM users_profile')).rows;
  });
  assert.deepEqual(
    ownProfile.map((row) => row.id),
    [userId],
  );
  for (const [role, sql] of [
    ['anon', 'SELECT id FROM organizations'],
    ['authenticated', 'SELECT password_hash FROM users_profile'],
    ['authenticated', 'SELECT token_hash FROM registrations'],
    ['authenticated', 'SELECT * FROM sessions'],
    ['authenticated', 'DELETE FROM organizations'],
  ]) {
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE ${role}`);
        await tx.query(sql);
      }),
      (error: unknown) => (error as { code?: string }).code === '42501',
    );
  }
  console.log(
    'RLS verified: repeated migration, tenant filtering, self profile, anonymous denial, protected credentials and server-only writes.',
  );
} finally {
  await db.close();
}

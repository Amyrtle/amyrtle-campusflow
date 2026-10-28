# Amyrtle CampusFlow

Build from `source-documents/Amyrtle_CampusFlow_Codex_Master_Prompt.docx` as authorized by the user. Report actual results; do not claim cloud deployment or live AI without verifying them.

## Structure and ownership
- `apps/web`: React, TypeScript, Vite frontend.
- `services/api`: Fastify service with server-side authorization and PostgreSQL persistence.
- `packages/shared`: shared Zod contracts and business constants.
- `cloudbase/migrations`: repeatable PostgreSQL schema and RLS.
- `tests`: business integration and Playwright browser checks.
- `docs`: architecture, deployment, verification, TDP handoff.

## Engineering rules
- Multi-agent parallel work is encouraged. Keep file ownership explicit and coordinate contract changes.
- Use local persisted PGlite for development and tests. Production supports native PostgreSQL via `DATABASE_URL` and, as explicitly approved by the user on 2026-10-26, CloudBase shared PostgreSQL via `DATABASE_MODE=cloudbase-http` with a server-only database API key. Local mode must be visibly labeled.
- Shared PostgreSQL mutations must use named business RPCs with atomic transactions; reads and simple writes use the fixed query catalog. Do not expose arbitrary SQL execution or use management SQL as the application runtime. Every privileged RPC must use `SECURITY INVOKER` and check `auth.role() IS DISTINCT FROM 'service_role'` inside its body; EXECUTE grants alone do not secure the CloudBase RPC gateway.
- Backend validates identity, organization membership, roles, event transitions, capacity and check-in tokens. Never rely on hidden UI controls.
- Public registration must be atomic and idempotent. Store only hashes of unpredictable check-in secrets. CSV fields must be formula-safe.
- AI mock output must be labeled. Missing facts remain pending confirmation. Never auto-publish generated content.
- Business timestamps are stored with timezone and displayed in Asia/Shanghai.
- Secrets stay in ignored environment files. Do not print secrets or commit participant data.
- No paid resources, production changes or public repository publication without explicit user approval.
- Required checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.
- Preserve the Word source. Keep `docs/PROGRESS.md` honest about completed, tested and blocked work.

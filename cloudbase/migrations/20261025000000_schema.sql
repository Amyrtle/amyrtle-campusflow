CREATE TABLE IF NOT EXISTS users_profile (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL,
 password_hash text, cloudbase_subject text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users_profile(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organizations (
 id uuid PRIMARY KEY, name text NOT NULL, created_by uuid NOT NULL REFERENCES users_profile(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_members (
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users_profile(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('Owner','Admin','Staff','Viewer')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE IF NOT EXISTS organization_invitations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 email text NOT NULL, role text NOT NULL CHECK(role IN ('Admin','Staff','Viewer')), token_hash text UNIQUE NOT NULL,
 expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activities (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, slug text UNIQUE NOT NULL,
 title text NOT NULL, description text NOT NULL DEFAULT '', category text NOT NULL, location text NOT NULL,
 start_time timestamptz NOT NULL, end_time timestamptz NOT NULL, registration_start timestamptz NOT NULL, registration_deadline timestamptz NOT NULL,
 capacity integer NOT NULL CHECK(capacity>0), status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Published','RegistrationClosed','InProgress','Completed','Archived','Cancelled')),
 cover_image text NOT NULL DEFAULT '', form_fields jsonb NOT NULL DEFAULT '[]', created_by uuid NOT NULL REFERENCES users_profile(id),
 registration_count integer NOT NULL DEFAULT 0 CHECK(registration_count>=0 AND registration_count<=capacity),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(end_time>start_time), CHECK(registration_deadline>=registration_start), CHECK(registration_deadline<=end_time)
);
CREATE INDEX IF NOT EXISTS activities_org_idx ON activities(organization_id, start_time);
CREATE TABLE IF NOT EXISTS activity_form_fields (
 activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE, field_id text NOT NULL, definition jsonb NOT NULL, PRIMARY KEY(activity_id, field_id)
);
CREATE TABLE IF NOT EXISTS activity_staff (
 activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users_profile(id) ON DELETE CASCADE, PRIMARY KEY(activity_id,user_id)
);
CREATE TABLE IF NOT EXISTS registrations (
 id uuid PRIMARY KEY, activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES organizations(id),
 display_name text NOT NULL, answers jsonb NOT NULL DEFAULT '{}', idempotency_key uuid NOT NULL, request_hash text NOT NULL, token_hash text UNIQUE NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(activity_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS registrations_activity_idx ON registrations(activity_id,created_at);
CREATE TABLE IF NOT EXISTS checkin_records (
 id uuid PRIMARY KEY, registration_id uuid NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
 activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES organizations(id),
 checked_in_by uuid NOT NULL REFERENCES users_profile(id), checked_in_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkin_activity_idx ON checkin_records(activity_id,checked_in_at);
CREATE TABLE IF NOT EXISTS surveys (
 id uuid PRIMARY KEY, activity_id uuid NOT NULL UNIQUE REFERENCES activities(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES organizations(id),
 title text NOT NULL, questions jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS survey_questions (
 survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE, question_id text NOT NULL, definition jsonb NOT NULL, PRIMARY KEY(survey_id,question_id)
);
CREATE TABLE IF NOT EXISTS survey_responses (
 id uuid PRIMARY KEY, survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES organizations(id),
 registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE, answers jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(survey_id, registration_id)
);
CREATE TABLE IF NOT EXISTS ai_generation_records (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 activity_id uuid REFERENCES activities(id) ON DELETE CASCADE, kind text NOT NULL CHECK(kind IN ('plan','insight')), mode text NOT NULL CHECK(mode IN ('mock','live')),
 output jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users_profile(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_org_idx ON ai_generation_records(organization_id,created_at);
CREATE TABLE IF NOT EXISTS audit_logs (
 id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE, actor_id uuid REFERENCES users_profile(id) ON DELETE SET NULL,
 action text NOT NULL, entity_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_org_idx ON audit_logs(organization_id,created_at);
CREATE TABLE IF NOT EXISTS ai_request_logs (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_requests_org_idx ON ai_request_logs(organization_id,created_at);

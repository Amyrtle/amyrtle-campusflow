-- Apply using the database owner during provisioning, before exposing PostgREST.
-- Runtime API connections must use a dedicated privileged server-only role.
-- All browser writes go through Fastify so capacity, ticket and role invariants apply.
BEGIN;

CREATE OR REPLACE FUNCTION public.campusflow_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET row_security = off
AS $$
 SELECT id FROM public.users_profile
 WHERE cloudbase_subject = (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
 LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.campusflow_has_role(org_id uuid, allowed_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET row_security = off
AS $$
 SELECT EXISTS(SELECT 1 FROM public.organization_members
 WHERE organization_id = org_id AND user_id = public.campusflow_user_id() AND role = ANY(allowed_roles))
$$;

CREATE OR REPLACE FUNCTION public.campusflow_can_read_activity(event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET row_security = off
AS $$
 SELECT EXISTS(SELECT 1 FROM public.activities a
 JOIN public.organization_members m ON m.organization_id=a.organization_id
 WHERE a.id=event_id AND m.user_id=public.campusflow_user_id()
 AND (m.role IN ('Owner','Admin','Viewer') OR EXISTS(SELECT 1 FROM public.activity_staff s WHERE s.activity_id=a.id AND s.user_id=m.user_id)))
$$;

CREATE OR REPLACE FUNCTION public.campusflow_can_read_participants(event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET row_security = off
AS $$
 SELECT EXISTS(SELECT 1 FROM public.activities a
 JOIN public.organization_members m ON m.organization_id=a.organization_id
 WHERE a.id=event_id AND m.user_id=public.campusflow_user_id()
 AND (m.role IN ('Owner','Admin') OR (m.role='Staff' AND EXISTS(SELECT 1 FROM public.activity_staff s WHERE s.activity_id=a.id AND s.user_id=m.user_id))))
$$;

REVOKE ALL ON FUNCTION public.campusflow_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campusflow_has_role(uuid,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campusflow_can_read_activity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campusflow_can_read_participants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campusflow_user_id(), public.campusflow_has_role(uuid,text[]), public.campusflow_can_read_activity(uuid), public.campusflow_can_read_participants(uuid) TO authenticated, service_role;

DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['users_profile','sessions','organizations','organization_members','organization_invitations','activities','activity_form_fields','activity_staff','registrations','checkin_records','surveys','survey_questions','survey_responses','ai_generation_records','audit_logs','ai_request_logs']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', table_name);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
  EXECUTE format('DROP POLICY IF EXISTS server_access ON public.%I', table_name);
  EXECUTE format('CREATE POLICY server_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', table_name);
 END LOOP;
END $$;

GRANT SELECT(id,email,display_name,created_at,updated_at) ON public.users_profile TO authenticated;
DROP POLICY IF EXISTS self_profile ON public.users_profile;
CREATE POLICY self_profile ON public.users_profile FOR SELECT TO authenticated USING(id=public.campusflow_user_id());

GRANT SELECT ON public.organizations,public.organization_members,public.activities,public.activity_form_fields,public.activity_staff,public.surveys,public.survey_questions TO authenticated;
DROP POLICY IF EXISTS member_organization ON public.organizations;
CREATE POLICY member_organization ON public.organizations FOR SELECT TO authenticated USING(public.campusflow_has_role(id,ARRAY['Owner','Admin','Staff','Viewer']));
DROP POLICY IF EXISTS manager_members ON public.organization_members;
CREATE POLICY manager_members ON public.organization_members FOR SELECT TO authenticated USING(user_id=public.campusflow_user_id() OR public.campusflow_has_role(organization_id,ARRAY['Owner','Admin']));
DROP POLICY IF EXISTS member_activity ON public.activities;
CREATE POLICY member_activity ON public.activities FOR SELECT TO authenticated USING(public.campusflow_can_read_activity(id));
DROP POLICY IF EXISTS member_fields ON public.activity_form_fields;
CREATE POLICY member_fields ON public.activity_form_fields FOR SELECT TO authenticated USING(public.campusflow_can_read_activity(activity_id));
DROP POLICY IF EXISTS member_staff ON public.activity_staff;
CREATE POLICY member_staff ON public.activity_staff FOR SELECT TO authenticated USING(public.campusflow_can_read_participants(activity_id));
DROP POLICY IF EXISTS member_survey ON public.surveys;
CREATE POLICY member_survey ON public.surveys FOR SELECT TO authenticated USING(public.campusflow_can_read_activity(activity_id));
DROP POLICY IF EXISTS member_questions ON public.survey_questions;
CREATE POLICY member_questions ON public.survey_questions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.surveys s WHERE s.id=survey_id AND public.campusflow_can_read_activity(s.activity_id)));

-- Ticket hashes, idempotency keys, password hashes, sessions, responses and audit
-- records are intentionally never granted to client roles. Fastify exposes safe
-- projections only after role checks. Aggregate survey results contain no names.
-- No authenticated INSERT/UPDATE/DELETE grants are made on business tables.
COMMIT;

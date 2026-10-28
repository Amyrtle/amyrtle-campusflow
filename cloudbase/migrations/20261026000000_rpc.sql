-- Server-only data-plane RPCs for CloudBase shared PostgreSQL.
-- Each mutate call is one database transaction. No SQL text is accepted.
-- CloudBase may not enforce RPC EXECUTE grants, so every entry point checks
-- the signed gateway role inside its body as well as using SECURITY INVOKER.
BEGIN;

CREATE OR REPLACE FUNCTION public.campusflow_rpc_assert(
  p_condition boolean, p_status integer, p_code text, p_message text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server credential required' USING ERRCODE = '42501';
  END IF;
  IF p_condition IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CF:' || p_code,
      DETAIL = jsonb_build_object('status', p_status, 'message', p_message)::text;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.campusflow_rpc_role(
  p_actor uuid, p_organization uuid, p_allowed text[]
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
DECLARE v_role text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server credential required' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_role FROM public.organization_members
    WHERE organization_id = p_organization AND user_id = p_actor FOR SHARE;
  PERFORM public.campusflow_rpc_assert(v_role = ANY(p_allowed), 403,
    'FORBIDDEN', '没有操作该组织数据的权限。');
  RETURN v_role;
END $$;

CREATE OR REPLACE FUNCTION public.campusflow_rpc_audit(
  p_organization uuid, p_actor uuid, p_action text, p_entity text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server credential required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.audit_logs(id, organization_id, actor_id, action, entity_id)
    VALUES(gen_random_uuid(), p_organization, p_actor, p_action, p_entity);
END $$;

CREATE OR REPLACE FUNCTION public.campusflow_mutate(p_operation text, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_activity public.activities%ROWTYPE;
  v_invitation public.organization_invitations%ROWTYPE;
  v_registration public.registrations%ROWTYPE;
  v_survey public.surveys%ROWTYPE;
  v_data jsonb;
  v_field jsonb;
  v_value jsonb;
  v_key text;
  v_answer text;
  v_status text;
  v_role text;
  v_actor uuid;
  v_id uuid;
  v_org uuid;
  v_survey_id uuid;
  v_count integer;
  v_empty boolean;
  v_created boolean;
  v_checked_at timestamptz;
  v_now timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server credential required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.campusflow_rpc_assert(jsonb_typeof(p_input) = 'object', 400,
    'INVALID_INPUT', '请求参数不正确。');
  v_actor := (p_input ->> 'actor_id')::uuid;

  CASE p_operation
  WHEN 'organization_create' THEN
    v_id := (p_input ->> 'id')::uuid;
    INSERT INTO public.organizations(id, name, created_by)
      VALUES(v_id, p_input ->> 'name', v_actor);
    INSERT INTO public.organization_members(organization_id, user_id, role)
      VALUES(v_id, v_actor, 'Owner');
    PERFORM public.campusflow_rpc_audit(v_id, v_actor, 'organization.created', v_id::text);
    RETURN jsonb_build_object('id', v_id, 'name', p_input ->> 'name', 'role', 'Owner');

  WHEN 'organization_join' THEN
    SELECT * INTO v_invitation FROM public.organization_invitations
      WHERE token_hash = p_input ->> 'token_hash' FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_invitation.id IS NOT NULL
      AND v_invitation.used_at IS NULL AND v_invitation.expires_at > clock_timestamp(),
      400, 'INVALID_INVITATION', '邀请无效或已过期。');
    PERFORM public.campusflow_rpc_assert(v_invitation.email = p_input ->> 'email',
      403, 'INVITATION_EMAIL_MISMATCH', '请使用受邀邮箱登录。');
    INSERT INTO public.organization_members(organization_id, user_id, role)
      VALUES(v_invitation.organization_id, v_actor, v_invitation.role) ON CONFLICT DO NOTHING;
    UPDATE public.organization_invitations SET used_at = clock_timestamp() WHERE id = v_invitation.id;
    PERFORM public.campusflow_rpc_audit(v_invitation.organization_id, v_actor,
      'member.joined', v_actor::text);
    RETURN jsonb_build_object('ok', true, 'organization_id', v_invitation.organization_id);

  WHEN 'activity_create' THEN
    v_id := (p_input ->> 'id')::uuid;
    v_org := (p_input ->> 'organization_id')::uuid;
    PERFORM public.campusflow_rpc_role(v_actor, v_org, ARRAY['Owner', 'Admin']);
    v_data := p_input -> 'activity';
    INSERT INTO public.activities(id, organization_id, slug, title, description, category,
      location, start_time, end_time, registration_start, registration_deadline, capacity,
      cover_image, form_fields, created_by)
    VALUES(v_id, v_org, p_input ->> 'slug', v_data ->> 'title', v_data ->> 'description',
      v_data ->> 'category', v_data ->> 'location', (v_data ->> 'start_time')::timestamptz,
      (v_data ->> 'end_time')::timestamptz, (v_data ->> 'registration_start')::timestamptz,
      (v_data ->> 'registration_deadline')::timestamptz, (v_data ->> 'capacity')::integer,
      v_data ->> 'cover_image', v_data -> 'form_fields', v_actor);
    INSERT INTO public.activity_form_fields(activity_id, field_id, definition)
      SELECT v_id, f ->> 'id', f FROM jsonb_array_elements(v_data -> 'form_fields') AS f;
    PERFORM public.campusflow_rpc_audit(v_org, v_actor, 'activity.created', v_id::text);
    RETURN jsonb_build_object('ok', true);

  WHEN 'activity_update' THEN
    SELECT * INTO v_activity FROM public.activities WHERE id = (p_input ->> 'id')::uuid FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_activity.id IS NOT NULL, 404, 'NOT_FOUND', '活动不存在。');
    PERFORM public.campusflow_rpc_role(v_actor, v_activity.organization_id, ARRAY['Owner', 'Admin']);
    v_data := p_input -> 'activity';
    PERFORM public.campusflow_rpc_assert(v_activity.status NOT IN ('Archived', 'Cancelled', 'Completed')
      AND (v_data ->> 'capacity')::integer >= v_activity.registration_count,
      409, 'ACTIVITY_CHANGED', '活动已更新，请刷新后重试。');
    UPDATE public.activities SET title = v_data ->> 'title', description = v_data ->> 'description',
      category = v_data ->> 'category', location = v_data ->> 'location',
      start_time = (v_data ->> 'start_time')::timestamptz, end_time = (v_data ->> 'end_time')::timestamptz,
      registration_start = (v_data ->> 'registration_start')::timestamptz,
      registration_deadline = (v_data ->> 'registration_deadline')::timestamptz,
      capacity = (v_data ->> 'capacity')::integer, cover_image = v_data ->> 'cover_image',
      form_fields = v_data -> 'form_fields', updated_at = clock_timestamp() WHERE id = v_activity.id;
    DELETE FROM public.activity_form_fields WHERE activity_id = v_activity.id;
    INSERT INTO public.activity_form_fields(activity_id, field_id, definition)
      SELECT v_activity.id, f ->> 'id', f FROM jsonb_array_elements(v_data -> 'form_fields') AS f;
    PERFORM public.campusflow_rpc_audit(v_activity.organization_id, v_actor,
      'activity.updated', v_activity.id::text);
    RETURN jsonb_build_object('ok', true);

  WHEN 'activity_status' THEN
    SELECT * INTO v_activity FROM public.activities WHERE id = (p_input ->> 'id')::uuid FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_activity.id IS NOT NULL, 404, 'NOT_FOUND', '活动不存在。');
    PERFORM public.campusflow_rpc_role(v_actor, v_activity.organization_id, ARRAY['Owner', 'Admin']);
    v_status := p_input ->> 'status';
    PERFORM public.campusflow_rpc_assert(CASE v_activity.status
      WHEN 'Draft' THEN v_status IN ('Published', 'Cancelled')
      WHEN 'Published' THEN v_status IN ('RegistrationClosed', 'InProgress', 'Cancelled')
      WHEN 'RegistrationClosed' THEN v_status IN ('Published', 'InProgress', 'Cancelled')
      WHEN 'InProgress' THEN v_status IN ('Completed', 'Cancelled')
      WHEN 'Completed' THEN v_status = 'Archived'
      WHEN 'Cancelled' THEN v_status = 'Archived'
      ELSE false END, 409, 'INVALID_TRANSITION', '不允许进行该活动状态变更。');
    IF v_status = 'Published' THEN
      v_now := clock_timestamp();
      PERFORM public.campusflow_rpc_assert(v_activity.registration_deadline > v_now AND v_activity.end_time > v_now,
        409, 'EVENT_EXPIRED', '请先更新活动和报名截止时间。');
    END IF;
    UPDATE public.activities SET status = v_status, updated_at = clock_timestamp() WHERE id = v_activity.id;
    PERFORM public.campusflow_rpc_audit(v_activity.organization_id, v_actor,
      'activity.status.' || v_status, v_activity.id::text);
    RETURN jsonb_build_object('ok', true);

  WHEN 'activity_delete' THEN
    SELECT * INTO v_activity FROM public.activities WHERE id = (p_input ->> 'id')::uuid FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_activity.id IS NOT NULL, 404, 'NOT_FOUND', '活动不存在。');
    PERFORM public.campusflow_rpc_role(v_actor, v_activity.organization_id, ARRAY['Owner', 'Admin']);
    PERFORM public.campusflow_rpc_assert(v_activity.status IN ('Draft', 'Archived', 'Cancelled'),
      409, 'DELETE_STATE', '请先取消或归档活动。');
    PERFORM public.campusflow_rpc_audit(v_activity.organization_id, v_actor,
      'activity.deleted', v_activity.id::text);
    DELETE FROM public.activities WHERE id = v_activity.id;
    RETURN jsonb_build_object('ok', true);

  WHEN 'registration_create' THEN
    SELECT * INTO v_activity FROM public.activities WHERE slug = p_input ->> 'slug' FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_activity.id IS NOT NULL, 404, 'NOT_FOUND', '活动不存在。');
    PERFORM public.campusflow_rpc_assert(v_activity.id = (p_input ->> 'activity_id')::uuid,
      409, 'ACTIVITY_CHANGED', '活动已更新，请刷新后重试。');
    SELECT * INTO v_registration FROM public.registrations WHERE activity_id = v_activity.id
      AND idempotency_key = (p_input ->> 'idempotency_key')::uuid;
    v_created := v_registration.id IS NULL;
    IF NOT v_created THEN
      PERFORM public.campusflow_rpc_assert(v_registration.request_hash = p_input ->> 'request_hash',
        409, 'IDEMPOTENCY_CONFLICT', '该请求标识已用于其他报名内容。');
    ELSE
      v_now := clock_timestamp();
      PERFORM public.campusflow_rpc_assert(v_activity.status = 'Published',
        409, 'REGISTRATION_CLOSED', '当前活动未开放报名。');
      PERFORM public.campusflow_rpc_assert(v_now >= v_activity.registration_start AND v_now <= v_activity.registration_deadline,
        409, 'REGISTRATION_CLOSED', '不在报名时间范围内。');
      v_data := p_input -> 'answers';
      PERFORM public.campusflow_rpc_assert(jsonb_typeof(v_data) = 'object', 400, 'INVALID_INPUT', '报名内容不正确。');
      FOR v_field IN SELECT * FROM jsonb_array_elements(v_activity.form_fields) LOOP
        v_answer := btrim(v_data ->> (v_field ->> 'id'));
        PERFORM public.campusflow_rpc_assert(NOT COALESCE((v_field ->> 'required')::boolean, false)
          OR COALESCE(v_answer, '') <> '', 400, 'MISSING_FIELD', '请填写' || (v_field ->> 'label') || '。');
        IF COALESCE(v_answer, '') <> '' AND v_field ->> 'type' = 'select' THEN
          PERFORM public.campusflow_rpc_assert((v_field -> 'options') ? v_answer,
            400, 'INVALID_OPTION', (v_field ->> 'label') || '的选项不正确。');
        END IF;
      END LOOP;
      FOR v_key IN SELECT jsonb_object_keys(v_data) LOOP
        PERFORM public.campusflow_rpc_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(v_activity.form_fields) f
          WHERE f ->> 'id' = v_key), 400, 'UNKNOWN_FIELD', '报名包含未配置字段。');
      END LOOP;
      UPDATE public.activities SET registration_count = registration_count + 1
        WHERE id = v_activity.id AND registration_count < capacity;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      PERFORM public.campusflow_rpc_assert(v_count = 1, 409, 'CAPACITY_FULL', '活动名额已满。');
      INSERT INTO public.registrations(id, activity_id, organization_id, display_name, answers,
        idempotency_key, request_hash, token_hash)
      VALUES(gen_random_uuid(), v_activity.id, v_activity.organization_id, p_input ->> 'display_name', v_data,
        (p_input ->> 'idempotency_key')::uuid, p_input ->> 'request_hash', p_input ->> 'token_hash')
        RETURNING * INTO v_registration;
      PERFORM public.campusflow_rpc_audit(v_activity.organization_id, NULL,
        'registration.created', v_registration.id::text);
    END IF;
    RETURN jsonb_build_object('created', v_created, 'registration_id', v_registration.id,
      'activity_id', v_activity.id, 'display_name', v_registration.display_name,
      'title', v_activity.title, 'start_time', v_activity.start_time, 'location', v_activity.location);

  WHEN 'registration_delete' THEN
    SELECT * INTO v_activity FROM public.activities WHERE id = (p_input ->> 'activity_id')::uuid FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_activity.id IS NOT NULL, 404, 'NOT_FOUND', '活动不存在。');
    PERFORM public.campusflow_rpc_role(v_actor, v_activity.organization_id, ARRAY['Owner', 'Admin']);
    DELETE FROM public.registrations WHERE id = (p_input ->> 'registration_id')::uuid
      AND activity_id = v_activity.id RETURNING * INTO v_registration;
    PERFORM public.campusflow_rpc_assert(v_registration.id IS NOT NULL, 404, 'NOT_FOUND', '报名记录不存在。');
    UPDATE public.activities SET registration_count = registration_count - 1 WHERE id = v_activity.id;
    PERFORM public.campusflow_rpc_audit(v_activity.organization_id, v_actor,
      'registration.deleted_by_manager', v_registration.id::text);
    RETURN jsonb_build_object('ok', true);

  WHEN 'checkin' THEN
    SELECT * INTO v_activity FROM public.activities WHERE id = (p_input ->> 'activity_id')::uuid FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_activity.id IS NOT NULL, 404, 'NOT_FOUND', '活动不存在。');
    v_role := public.campusflow_rpc_role(v_actor, v_activity.organization_id, ARRAY['Owner', 'Admin', 'Staff']);
    IF v_role = 'Staff' THEN
      PERFORM public.campusflow_rpc_assert(EXISTS(SELECT 1 FROM public.activity_staff
        WHERE activity_id = v_activity.id AND user_id = v_actor), 403, 'FORBIDDEN', '您尚未分配到该活动。');
    END IF;
    PERFORM public.campusflow_rpc_assert(v_activity.status IN ('Published', 'RegistrationClosed', 'InProgress'),
      409, 'CHECKIN_CLOSED', '该活动当前无法签到。');
    SELECT * INTO v_registration FROM public.registrations
      WHERE token_hash = p_input ->> 'token_hash' AND activity_id = v_activity.id FOR UPDATE;
    IF v_registration.id IS NULL THEN
      PERFORM public.campusflow_rpc_assert(NOT EXISTS(SELECT 1 FROM public.registrations
        WHERE token_hash = p_input ->> 'token_hash'), 409, 'EVENT_MISMATCH', '凭证不属于当前活动。');
      PERFORM public.campusflow_rpc_assert(false, 400, 'INVALID_TICKET', '签到凭证无效。');
    END IF;
    INSERT INTO public.checkin_records(id, registration_id, activity_id, organization_id, checked_in_by)
      VALUES(gen_random_uuid(), v_registration.id, v_activity.id, v_activity.organization_id, v_actor)
      ON CONFLICT(registration_id) DO NOTHING RETURNING checked_in_at INTO v_checked_at;
    v_created := FOUND;
    IF v_created THEN
      PERFORM public.campusflow_rpc_audit(v_activity.organization_id, v_actor,
        'registration.checked_in', v_registration.id::text);
    ELSE
      SELECT checked_in_at INTO v_checked_at FROM public.checkin_records WHERE registration_id = v_registration.id;
    END IF;
    RETURN jsonb_build_object('already_checked_in', NOT v_created, 'registration',
      jsonb_build_object('id', v_registration.id, 'activity_id', v_registration.activity_id,
        'display_name', v_registration.display_name, 'answers', v_registration.answers,
        'created_at', v_registration.created_at, 'checked_in_at', v_checked_at));

  WHEN 'registration_cancel' THEN
    SELECT * INTO v_activity FROM public.activities WHERE slug = p_input ->> 'slug' FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_activity.id IS NOT NULL, 404, 'NOT_FOUND', '活动不存在。');
    DELETE FROM public.registrations WHERE token_hash = p_input ->> 'token_hash'
      AND activity_id = v_activity.id RETURNING * INTO v_registration;
    PERFORM public.campusflow_rpc_assert(v_registration.id IS NOT NULL,
      404, 'NOT_FOUND', '凭证无效或报名已删除。');
    UPDATE public.activities SET registration_count = registration_count - 1 WHERE id = v_activity.id;
    PERFORM public.campusflow_rpc_audit(v_activity.organization_id, NULL,
      'registration.deleted', v_registration.id::text);
    RETURN jsonb_build_object('ok', true);

  WHEN 'ai_reserve' THEN
    v_org := (p_input ->> 'organization_id')::uuid;
    PERFORM id FROM public.organizations WHERE id = v_org FOR UPDATE;
    PERFORM public.campusflow_rpc_role(v_actor, v_org, ARRAY['Owner', 'Admin']);
    v_now := clock_timestamp();
    SELECT count(*)::integer INTO v_count FROM public.ai_request_logs
      WHERE organization_id = v_org AND created_at > v_now - interval '1 hour';
    PERFORM public.campusflow_rpc_assert(v_count < 30, 429, 'AI_LIMIT', '组织每小时最多生成 30 次，请稍后重试。');
    INSERT INTO public.ai_request_logs(id, organization_id, created_at) VALUES(gen_random_uuid(), v_org, v_now);
    RETURN jsonb_build_object('ok', true);

  WHEN 'survey_save' THEN
    SELECT * INTO v_activity FROM public.activities WHERE id = (p_input ->> 'activity_id')::uuid FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_activity.id IS NOT NULL, 404, 'NOT_FOUND', '活动不存在。');
    PERFORM public.campusflow_rpc_role(v_actor, v_activity.organization_id, ARRAY['Owner', 'Admin']);
    SELECT * INTO v_survey FROM public.surveys WHERE activity_id = v_activity.id FOR UPDATE;
    IF v_survey.id IS NOT NULL THEN
      PERFORM public.campusflow_rpc_assert(NOT EXISTS(SELECT 1 FROM public.survey_responses WHERE survey_id = v_survey.id),
        409, 'SURVEY_LOCKED', '收到反馈后不能修改问卷结构。');
    END IF;
    v_data := p_input -> 'questions';
    PERFORM public.campusflow_rpc_assert(jsonb_typeof(v_data) = 'array'
      AND jsonb_array_length(v_data) BETWEEN 1 AND 20, 400, 'INVALID_INPUT', '问卷问题不正确。');
    PERFORM public.campusflow_rpc_assert((SELECT count(*) = count(DISTINCT q ->> 'id')
      FROM jsonb_array_elements(v_data) q), 400, 'DUPLICATE_QUESTION', '问题标识不能重复。');
    FOR v_field IN SELECT * FROM jsonb_array_elements(v_data) LOOP
      IF v_field ->> 'type' IN ('single', 'multiple') THEN
        PERFORM public.campusflow_rpc_assert(jsonb_typeof(v_field -> 'options') = 'array'
          AND jsonb_array_length(v_field -> 'options') >= 2, 400, 'QUESTION_OPTIONS', '选择题至少需要两个选项。');
      END IF;
    END LOOP;
    v_id := COALESCE(v_survey.id, gen_random_uuid());
    INSERT INTO public.surveys(id, activity_id, organization_id, title, questions)
      VALUES(v_id, v_activity.id, v_activity.organization_id, p_input ->> 'title', v_data)
      ON CONFLICT(activity_id) DO UPDATE SET title = EXCLUDED.title, questions = EXCLUDED.questions,
        updated_at = clock_timestamp() RETURNING * INTO v_survey;
    DELETE FROM public.survey_questions WHERE survey_id = v_survey.id;
    INSERT INTO public.survey_questions(survey_id, question_id, definition)
      SELECT v_survey.id, q ->> 'id', q FROM jsonb_array_elements(v_data) q;
    PERFORM public.campusflow_rpc_audit(v_activity.organization_id, v_actor, 'survey.updated', v_survey.id::text);
    RETURN to_jsonb(v_survey);

  WHEN 'survey_submit' THEN
    v_survey_id := (p_input ->> 'survey_id')::uuid;
    -- Lock the activity first, then survey, matching updates/deletes/check-in.
    SELECT a.* INTO v_activity FROM public.activities a JOIN public.surveys s ON s.activity_id = a.id
      WHERE s.id = v_survey_id FOR UPDATE OF a;
    PERFORM public.campusflow_rpc_assert(v_activity.id IS NOT NULL
      AND v_activity.status NOT IN ('Draft', 'Cancelled'), 404, 'NOT_FOUND', '问卷不存在或已关闭。');
    SELECT * INTO v_survey FROM public.surveys WHERE id = v_survey_id FOR UPDATE;
    PERFORM public.campusflow_rpc_assert(v_survey.id IS NOT NULL, 404, 'NOT_FOUND', '问卷不存在或已关闭。');
    SELECT * INTO v_registration FROM public.registrations WHERE token_hash = p_input ->> 'token_hash'
      AND activity_id = v_survey.activity_id FOR KEY SHARE;
    PERFORM public.campusflow_rpc_assert(v_registration.id IS NOT NULL,
      403, 'INVALID_TICKET', '请使用该活动有效报名凭证提交反馈。');
    v_data := p_input -> 'answers';
    PERFORM public.campusflow_rpc_assert(jsonb_typeof(v_data) = 'object', 400, 'INVALID_INPUT', '问卷答案不正确。');
    v_empty := true;
    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(v_data) LOOP
      IF (jsonb_typeof(v_value) = 'array' AND jsonb_array_length(v_value) > 0)
        OR (jsonb_typeof(v_value) IN ('string', 'number') AND btrim(v_value #>> '{}') <> '') THEN
        v_empty := false;
      END IF;
      PERFORM public.campusflow_rpc_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(v_survey.questions) q
        WHERE q ->> 'id' = v_key), 400, 'UNKNOWN_FIELD', '问卷包含未知问题。');
    END LOOP;
    PERFORM public.campusflow_rpc_assert(NOT v_empty, 400, 'EMPTY_RESPONSE', '请至少填写一项反馈。');
    FOR v_field IN SELECT * FROM jsonb_array_elements(v_survey.questions) LOOP
      v_value := v_data -> (v_field ->> 'id');
      v_empty := v_value IS NULL OR v_value = '""'::jsonb
        OR (jsonb_typeof(v_value) = 'array' AND jsonb_array_length(v_value) = 0);
      PERFORM public.campusflow_rpc_assert(NOT COALESCE((v_field ->> 'required')::boolean, false) OR NOT v_empty,
        400, 'MISSING_FIELD', '请回答' || (v_field ->> 'title') || '。');
      IF v_empty THEN CONTINUE; END IF;
      CASE v_field ->> 'type'
      WHEN 'rating' THEN
        PERFORM public.campusflow_rpc_assert(jsonb_typeof(v_value) = 'number', 400, 'INVALID_ANSWER', '评分需要为 1 至 5。');
        PERFORM public.campusflow_rpc_assert((v_value #>> '{}')::numeric BETWEEN 1 AND 5
          AND trunc((v_value #>> '{}')::numeric) = (v_value #>> '{}')::numeric,
          400, 'INVALID_ANSWER', '评分需要为 1 至 5。');
      WHEN 'single' THEN
        PERFORM public.campusflow_rpc_assert(jsonb_typeof(v_value) = 'string'
          AND (v_field -> 'options') ? (v_value #>> '{}'), 400, 'INVALID_ANSWER', '请选择有效选项。');
      WHEN 'multiple' THEN
        PERFORM public.campusflow_rpc_assert(jsonb_typeof(v_value) = 'array', 400, 'INVALID_ANSWER', '请选择有效且不重复的选项。');
        PERFORM public.campusflow_rpc_assert((SELECT count(*) = count(DISTINCT a)
          AND bool_and(jsonb_typeof(a) = 'string' AND (v_field -> 'options') ? (a #>> '{}'))
          FROM jsonb_array_elements(v_value) a), 400, 'INVALID_ANSWER', '请选择有效且不重复的选项。');
      WHEN 'text' THEN
        PERFORM public.campusflow_rpc_assert(jsonb_typeof(v_value) = 'string', 400, 'INVALID_ANSWER', '请输入文本。');
      ELSE
        PERFORM public.campusflow_rpc_assert(false, 400, 'INVALID_ANSWER', '问卷问题类型不正确。');
      END CASE;
    END LOOP;
    v_id := gen_random_uuid();
    v_now := clock_timestamp();
    INSERT INTO public.survey_responses(id, survey_id, organization_id, registration_id, answers, created_at)
      VALUES(v_id, v_survey.id, v_survey.organization_id, v_registration.id, v_data, v_now)
      ON CONFLICT(survey_id, registration_id) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    PERFORM public.campusflow_rpc_assert(v_count = 1, 409, 'ALREADY_RESPONDED', '此报名凭证已提交反馈。');
    RETURN jsonb_build_object('id', v_id, 'submitted_at', v_now);

  ELSE
    PERFORM public.campusflow_rpc_assert(false, 400, 'UNKNOWN_OPERATION', '不支持的数据库操作。');
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.campusflow_rpc_assert(boolean, integer, text, text),
  public.campusflow_rpc_role(uuid, uuid, text[]), public.campusflow_rpc_audit(uuid, uuid, text, text),
  public.campusflow_mutate(text, jsonb) FROM PUBLIC;
DO $$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.campusflow_rpc_assert(boolean,integer,text,text), public.campusflow_rpc_role(uuid,uuid,text[]), public.campusflow_rpc_audit(uuid,uuid,text,text), public.campusflow_mutate(text,jsonb) FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.campusflow_rpc_assert(boolean, integer, text, text),
      public.campusflow_rpc_role(uuid, uuid, text[]), public.campusflow_rpc_audit(uuid, uuid, text, text),
      public.campusflow_mutate(text, jsonb) TO service_role;
  END IF;
END $$;
COMMIT;

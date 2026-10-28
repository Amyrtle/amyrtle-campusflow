-- The CloudBase gateway preserves MESSAGE but may omit PostgreSQL DETAIL.
-- Carry the structured business error in MESSAGE without changing old migrations.
BEGIN;

CREATE OR REPLACE FUNCTION public.campusflow_rpc_assert(
  p_condition boolean, p_status integer, p_code text, p_message text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
DECLARE v_detail text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server credential required' USING ERRCODE = '42501';
  END IF;
  IF p_condition IS NOT TRUE THEN
    v_detail := jsonb_build_object('status', p_status, 'message', p_message)::text;
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CF:' || p_code || ':' || v_detail,
      DETAIL = v_detail;
  END IF;
END $$;

COMMIT;

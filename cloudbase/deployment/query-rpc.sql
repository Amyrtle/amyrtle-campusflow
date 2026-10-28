BEGIN;
CREATE SCHEMA IF NOT EXISTS campusflow_internal;
REVOKE ALL ON SCHEMA campusflow_internal FROM PUBLIC;
CREATE TABLE IF NOT EXISTS campusflow_internal.query_catalog (
 id text PRIMARY KEY, statement text NOT NULL, parameter_count integer NOT NULL,
 returns_rows boolean NOT NULL
);
REVOKE ALL ON campusflow_internal.query_catalog FROM PUBLIC;
-- QUERY_CATALOG_VALUES

CREATE OR REPLACE FUNCTION public.campusflow_query(p_id text, p_params jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $function$
DECLARE
 spec record; remaining text; rendered text := ''; parameter_match text[]; position integer;
 parameter_index integer; parameter_value jsonb; affected bigint; result jsonb;
BEGIN
 -- The platform may bypass EXECUTE grants for RPC; enforce identity inside the body.
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Server access required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO spec FROM campusflow_internal.query_catalog WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown server query' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_params) IS DISTINCT FROM 'array' OR jsonb_array_length(p_params)<>spec.parameter_count THEN
  RAISE EXCEPTION 'Invalid query parameters' USING ERRCODE='22023';
 END IF;
 remaining := spec.statement;
 LOOP
  parameter_match := regexp_match(remaining,'\$([0-9]+)');
  IF parameter_match IS NULL THEN rendered := rendered || remaining; EXIT; END IF;
  parameter_index := parameter_match[1]::integer;
  position := strpos(remaining,'$'||parameter_match[1]);
  parameter_value := p_params->(parameter_index-1);
  IF jsonb_typeof(parameter_value) NOT IN ('string','number','boolean','null') THEN
   RAISE EXCEPTION 'Only scalar SQL parameters are supported' USING ERRCODE='22023';
  END IF;
  -- quote_nullable produces SQL literals; parameter text can never become SQL syntax.
  rendered := rendered || substr(remaining,1,position-1) || quote_nullable(p_params->>(parameter_index-1));
  remaining := substr(remaining,position+length(parameter_match[1])+1);
 END LOOP;
 IF spec.returns_rows THEN
  EXECUTE 'WITH query_result AS ('||rendered||') SELECT jsonb_build_object(''rows'',coalesce(jsonb_agg(to_jsonb(query_result)),''[]''::jsonb),''rowCount'',count(*)) FROM query_result' INTO result;
 ELSE
  EXECUTE rendered;
  GET DIAGNOSTICS affected = ROW_COUNT;
  result := jsonb_build_object('rows','[]'::jsonb,'rowCount',affected);
 END IF;
 RETURN result;
END
$function$;
REVOKE ALL ON FUNCTION public.campusflow_query(text,jsonb) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT USAGE ON SCHEMA campusflow_internal TO service_role;
  GRANT SELECT ON campusflow_internal.query_catalog TO service_role;
  GRANT EXECUTE ON FUNCTION public.campusflow_query(text,jsonb) TO service_role;
 END IF;
END
$grants$;
COMMIT;

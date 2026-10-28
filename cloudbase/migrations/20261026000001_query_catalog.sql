-- Generated fixed query allowlist. Never accept SQL text from clients.
BEGIN;
CREATE SCHEMA IF NOT EXISTS campusflow_internal;
REVOKE ALL ON SCHEMA campusflow_internal FROM PUBLIC;
CREATE TABLE IF NOT EXISTS campusflow_internal.query_catalog (
 id text PRIMARY KEY, statement text NOT NULL, parameter_count integer NOT NULL,
 returns_rows boolean NOT NULL
);
REVOKE ALL ON campusflow_internal.query_catalog FROM PUBLIC;
INSERT INTO campusflow_internal.query_catalog(id,statement,parameter_count,returns_rows) VALUES
('05cfb077b314deabe558ba5e3e211cc197afbe1e2a55ae04b620151e9e5b5a57','UPDATE ai_generation_records SET output=$1,updated_at=now() WHERE id=$2 AND organization_id=$3 AND kind=''plan'' RETURNING id,mode,output AS plan',3,true),
('09338bc13c6fcf41f88f7f06dbb8c4d37305ee6fe834d762f509ed60c0542100','SELECT id,email,display_name,password_hash FROM users_profile WHERE email=$1',1,true),
('0b6a1058d2feaf9e0596c8d259f39f05484e6e2c8f2d738f2238cefca4b4d673','SELECT id,mode,output->>''report'' AS report FROM ai_generation_records WHERE activity_id=$1 AND kind=''insight'' ORDER BY created_at DESC LIMIT 1',1,true),
('0b9996b7bd0e75284747abab98cefe730f538a8ab333b2149e334ec1c4c5d964','UPDATE organization_members SET role=$1 WHERE organization_id=$2 AND user_id=$3 AND role<>$4 RETURNING user_id',4,true),
('1241238ef21d8ca7ea5e254cf37e050d7951c606b5e5743bb71c0eb4eb8edab3','SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2',2,true),
('1a511faa1b8f51780b4a6afd58b2bc68622b451d43323be2433e0e5ca02ca9f5','SELECT to_char(created_at AT TIME ZONE ''Asia/Shanghai'',''YYYY-MM-DD'') AS date,count(*)::int AS count FROM registrations WHERE activity_id=$1 GROUP BY 1 ORDER BY 1',1,true),
('238e42329a6a732af63130da5fd142c43c4e457b6c3764a04930bb55ed9ded1f','SELECT u.id AS user_id,u.email,u.display_name FROM activity_staff s JOIN users_profile u ON u.id=s.user_id WHERE s.activity_id=$1',1,true),
('29b86a9e67c90a3e9c9345519f170e53ed73f6f252ab4d57f873a53a2fdd3e11','DELETE FROM activity_staff WHERE activity_id=$1 AND user_id=$2',2,false),
('2dd386b25271886b9df337cc2fa6432a69f8ce738aa25c8e9e8ccd455010fa3d','SELECT * FROM surveys WHERE activity_id=$1',1,true),
('33e8c0644c35717f05df92bf249c2100a0ca9458c5572ddc16d3e89aefb82811','SELECT 1 FROM activity_staff WHERE activity_id=$1 AND user_id=$2',2,true),
('3f884070d25a79b522347a4669309c4b8b11d840ec773c83a07de98c2ce83796','SELECT a.*, (SELECT count(*)::int FROM checkin_records c WHERE c.activity_id=a.id) AS checkin_count FROM activities a WHERE a.organization_id=$1 AND EXISTS(SELECT 1 FROM activity_staff s WHERE s.activity_id=a.id AND s.user_id=$2) ORDER BY a.created_at DESC',2,true),
('489423c5321c5217702e5f7a9cc28e4a6c254a1c46e6ac6a0b666a5d20d5b662','SELECT s.id,s.activity_id,s.title,s.questions FROM surveys s JOIN activities a ON a.id=s.activity_id WHERE s.id=$1 AND a.status NOT IN (''Draft'',''Cancelled'')',1,true),
('4e3354f5443cad12bd773c570552071ec9af45eb00aca76cf641c1dfb94263e5','SELECT a.*, (SELECT count(*)::int FROM checkin_records c WHERE c.activity_id=a.id) AS checkin_count FROM activities a WHERE a.slug=$1 AND a.status<>$2',2,true),
('4fd166afe6fc3f40952dd96b0c01ebbf07a3bf36d413e86701135253d03fcde8','INSERT INTO users_profile(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',4,false),
('512f34422cbd41b5e2f00c5331c4078bce8d27f0432221f927131a7e76ff9648','SELECT r.answers FROM survey_responses r JOIN surveys s ON s.id=r.survey_id WHERE s.activity_id=$1',1,true),
('513aeadd7d84fc142d8389d7dca0fff1d585a90b353baccfb8164ef2478b10a1','INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)',6,false),
('57193a983ce79c1467844904efc84ff00cd7049f26a3c9df6d6ed959eb4d8b75','DELETE FROM sessions WHERE token_hash=$1',1,false),
('577d86753efad4f6067286ad674fb954dcaa225667e3728df36f084046733e61','SELECT answers FROM survey_responses WHERE survey_id=$1',1,true),
('5e9e83c49a08ccac96495ed0b0087b0c272bd8874fa7cabf32c848a15629e873','SELECT id,email,display_name FROM users_profile WHERE cloudbase_subject=$1',1,true),
('61ed2b3aef9682bcc14c0928287e69deecdb66b86a96891e6b84ced393064eeb','DELETE FROM activity_staff WHERE user_id=$1 AND activity_id IN (SELECT id FROM activities WHERE organization_id=$2)',2,false),
('692279436db678c6c24dd30dc8785bb2b4e63237d2f0bfd641222225fa606280','UPDATE ai_generation_records SET output=$1,updated_at=now() WHERE id=(SELECT id FROM ai_generation_records WHERE activity_id=$2 AND kind=''insight'' ORDER BY created_at DESC LIMIT 1) RETURNING id,mode,output->>''report'' AS report',2,true),
('6c27d9674419bdcd44fceeda3c9423f2eb3d31671de5cfffc47b18abe91f3d6f','SELECT to_char(checked_in_at AT TIME ZONE ''Asia/Shanghai'',''YYYY-MM-DD HH24:00'') AS date,count(*)::int AS count FROM checkin_records WHERE activity_id=$1 GROUP BY 1 ORDER BY 1',1,true),
('7de157113ca4c33c61816fb5caa577be0d22226a778e93488e80b5a066306443','SELECT a.*, (SELECT count(*)::int FROM checkin_records c WHERE c.activity_id=a.id) AS checkin_count FROM activities a WHERE a.id=$1',1,true),
('8156e2b20264e1b52d63d8180a3218be8375439090edf70e8933499fe3e11b90','UPDATE users_profile SET display_name=$1,updated_at=now() WHERE id=$2',2,false),
('82603076a2ede067535a70a1e7253cba82eea31f14e46ff8454970cee580b9f9','INSERT INTO activity_staff(activity_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',2,false),
('8c8b7f84e25f4257e053bc66b65f29dd40a293d2af9ba5a9e5c135b3888884fc','SELECT s.*,(SELECT count(*)::int FROM survey_responses r WHERE r.survey_id=s.id) AS response_count FROM surveys s WHERE s.activity_id=$1',1,true),
('96bc4ffbc81dea16e13079c84ab9e14f66a1f89ac4ba6831b6c66324c6160909','SELECT id FROM activities WHERE slug=$1',1,true),
('9edca90b0bc9bb35760abf7ce786163e961c30f435a98a1f26c085c8b6d51586','INSERT INTO users_profile(id,email,display_name,cloudbase_subject) VALUES($1,$2,$3,$4) ON CONFLICT(cloudbase_subject) DO NOTHING',4,false),
('a48bd59d4ba9f72c78ed8f3e408ba4fb5452f264c54030659c9534a0d4577d08','INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',3,false),
('a80f1efd54671cced34c9a61249c00faac0e14f9e193989fb1a8fb75ff56c2ce','INSERT INTO ai_generation_records(id,organization_id,kind,mode,output,created_by) VALUES($1,$2,$3,$4,$5,$6)',6,false),
('b326810ed8477ff4a725a7b01c5e8cb87afc343d1a2827626ab0bcd8fa7f2497','SELECT a.*, (SELECT count(*)::int FROM checkin_records c WHERE c.activity_id=a.id) AS checkin_count FROM activities a WHERE a.organization_id=$1 ORDER BY a.created_at DESC',1,true),
('b3fa5254aff63d852f044b01b46355464c01522cefe9eab5b0306d45769e271e','SELECT u.id AS user_id,u.email,u.display_name,m.role FROM organization_members m JOIN users_profile u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY m.created_at',1,true),
('bee5fbf61c528f6bc137a0854c0e86457433eb1824dcd159536aa73f091bf44e','SELECT r.id,r.activity_id,r.display_name,r.answers,r.created_at,c.checked_in_at FROM registrations r LEFT JOIN checkin_records c ON c.registration_id=r.id WHERE r.activity_id=$1 ORDER BY r.created_at DESC',1,true),
('c2230162d2fd8a6a687aeaccfc9c5c8b22af95a6f48acdca2be8919740db9dd9','DELETE FROM sessions WHERE expires_at < now()',0,false),
('c324d09594a2401917fc3b42892fdcfd514c3189b6ab6989aba20f50db694a02','SELECT o.id,o.name,m.role FROM organizations o JOIN organization_members m ON m.organization_id=o.id WHERE m.user_id=$1 ORDER BY o.created_at',1,true),
('c5472e0e5e539b460bd6ac96998ed4ec17e1e7fc95d7a1e770b5ba0ec034395b','SELECT id,mode,output AS plan,created_at FROM ai_generation_records WHERE organization_id=$1 AND kind=''plan'' ORDER BY created_at DESC',1,true),
('d383bf43fb776faeb46d83905f8293f59a0105f655c1c978134f9dee3e67fc36','INSERT INTO ai_generation_records(id,organization_id,activity_id,kind,mode,output,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',7,false),
('dd7a7ecc8d1b829a728d2271a8675ec23fb2e69848b9e886081811c320c86e5c','SELECT (SELECT count(*)::int FROM registrations WHERE activity_id=$1) AS registrations,(SELECT count(*)::int FROM checkin_records WHERE activity_id=$1) AS checkins',1,true),
('e004ebd5b5532a4b85984a62f8ad48a81aa3460c1ca07701f386135d72cdecf5','SELECT 1',0,true),
('e3d324691dbda68ffe35f0542d9cf0c17f757076bc57a9a91963ee642f33467a','SELECT u.id,u.email,u.display_name FROM sessions s JOIN users_profile u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',1,true),
('f43a3a4aced01d860fcea9e5e7b2e92a2f328c9b58dab68c2c4f06b1fd6feb91','DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND role<>$3 RETURNING user_id',3,true),
('f57fbdeb6afb7bf45510087b03b449862a5a39683f53569740706abd96e8705a','INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_id) VALUES($1,$2,$3,$4,$5)',5,false),
('f8a5235fd820af0f57380c004fdfaebbe13647399217a39bf76a7bb13a2ed920','SELECT r.display_name,r.answers,r.created_at,c.checked_in_at FROM registrations r LEFT JOIN checkin_records c ON c.registration_id=r.id WHERE r.activity_id=$1 ORDER BY r.created_at',1,true)
ON CONFLICT(id) DO UPDATE SET statement=EXCLUDED.statement,parameter_count=EXCLUDED.parameter_count,returns_rows=EXCLUDED.returns_rows;

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

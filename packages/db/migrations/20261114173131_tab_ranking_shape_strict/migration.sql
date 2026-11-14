-- TAB-6.18: the ranking shape CHECK reads each place strictly. In lax mode
-- the path unwrapped every place, so it refused every well-formed ranking.
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_ranking_shape_check", ADD CONSTRAINT "rounds_ranking_shape_check" CHECK ("ranking" is null or (jsonb_typeof("ranking") = 'array' and jsonb_array_length("ranking") > 0 and not jsonb_path_exists("ranking", 'strict $[*] ? (@.type() != "array" || @.size() == 0)') and not jsonb_path_exists("ranking", 'strict $[*][*] ? (@.type() != "string")')));

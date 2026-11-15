-- Before stored execution existed, a non-null judging body was the exact Daisy
-- registry definition selected at Start. Preserve its original key/revision.
UPDATE "rounds" SET "judging" = jsonb_set("judging", '{source}', jsonb_build_object(
  'kind', 'daisy', 'key', "judging"->'ballot'->>'key',
  'revision', "judging"->'ballot'->'revision'))
WHERE "judging" IS NOT NULL AND NOT ("judging" ? 'source');
--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "ballot_definition_id" text GENERATED ALWAYS AS (case when judging->'source'->>'kind' = 'stored' then judging->'source'->>'id' else null end) STORED;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "ballot_definition_version" integer GENERATED ALWAYS AS (case when judging->'source'->>'kind' = 'stored' then (judging->'source'->>'version')::integer else null end) STORED;--> statement-breakpoint
CREATE INDEX "rounds_ballot_definition_idx" ON "rounds" ("ballot_definition_id","ballot_definition_version");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_ballot_definition_fk" FOREIGN KEY ("ballot_definition_id","ballot_definition_version") REFERENCES "ballot_definition_versions"("ballot_definition_id","version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_judging_source_check" CHECK ("judging" is null or coalesce(
        jsonb_typeof("judging"->'source') = 'object' and
        case "judging"->'source'->>'kind'
          when 'daisy' then
            "judging"->'source'->>'key' = "judging"->'ballot'->>'key' and
            "judging"->'source'->'revision' = "judging"->'ballot'->'revision' and
            (("judging"->'source'->>'key') || '@' || ("judging"->'source'->>'revision')) in ('speaker-10@1', 'speaker-10@2', 'rank-sides@1', 'rank-speakers@1')
          when 'stored' then
            "judging"->'source'->>'id' ~ '^[a-z0-9]{24}$' and
            jsonb_typeof("judging"->'source'->'version') = 'number' and
            "judging"->'source'->'version' = "judging"->'ballot'->'revision' and
            "ballot_definition_version" > 0
          else false end, false));
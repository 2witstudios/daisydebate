ALTER TABLE "rounds" ALTER COLUMN "runtime_state" SET DEFAULT '{"version":1,"prep_consumed_ms":{"affirmative":0,"negative":0},"active_prep":null,"floor":null,"incident":{"phase":"none"},"start_gate":null,"clock_stops":[]}';--> statement-breakpoint
-- The checkpoint schema is strict, so every stored checkpoint gains the new field.
-- A merge of two objects with constant keys cannot refuse.
UPDATE "rounds" SET "runtime_state" = '{"start_gate":null}'::jsonb || "runtime_state" WHERE NOT ("runtime_state" ? 'start_gate');

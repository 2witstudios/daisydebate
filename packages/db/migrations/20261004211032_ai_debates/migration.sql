CREATE TABLE "ai_debate_ballots" (
	"ai_debate_id" text PRIMARY KEY,
	"winner" text NOT NULL,
	"ballot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_debate_ballots_winner_check" CHECK ("winner" in ('affirmative', 'negative')),
	CONSTRAINT "ai_debate_ballots_ballot_is_object" CHECK (jsonb_typeof("ballot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai_debate_commands" (
	"ai_debate_id" text,
	"sequence" integer,
	"type" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"turn_index" integer,
	"reason" text,
	CONSTRAINT "ai_debate_commands_pkey" PRIMARY KEY("ai_debate_id","sequence"),
	CONSTRAINT "ai_debate_commands_type_check" CHECK ("type" in ('start', 'startSpeech', 'yield', 'abort')),
	CONSTRAINT "ai_debate_commands_reason_check" CHECK (("type" = 'abort') = ("reason" is not null) and ("reason" is null or "reason" in ('person', 'vendor-failure'))),
	CONSTRAINT "ai_debate_commands_turn_check" CHECK (("type" = 'yield') = ("turn_index" is not null)),
	CONSTRAINT "ai_debate_commands_sequence_check" CHECK ("sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_debate_utterances" (
	"id" text PRIMARY KEY,
	"ai_debate_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"turn_index" integer NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"complete" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_debate_utterances_sequence_unique" UNIQUE("ai_debate_id","sequence"),
	CONSTRAINT "ai_debate_utterances_role_check" CHECK ("role" in ('person', 'ai')),
	CONSTRAINT "ai_debate_utterances_turn_check" CHECK ("turn_index" >= 0 and "sequence" >= 0),
	CONSTRAINT "ai_debate_utterances_text_length" CHECK (char_length("text") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "ai_debates" (
	"id" text PRIMARY KEY,
	"actor_id" text NOT NULL,
	"resolution" text NOT NULL,
	"person_side" text NOT NULL,
	"opponent" text NOT NULL,
	"voice" text NOT NULL,
	"speech_model" text NOT NULL,
	"cx_model" text NOT NULL,
	"judge_model" text NOT NULL,
	"tts_model" text NOT NULL,
	"stt_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_end_at" timestamp with time zone NOT NULL,
	"counted_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"tts_characters" integer DEFAULT 0 NOT NULL,
	"stt_requests" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_debates_person_side_check" CHECK ("person_side" in ('affirmative', 'negative')),
	CONSTRAINT "ai_debates_resolution_length" CHECK (char_length("resolution") between 3 and 200),
	CONSTRAINT "ai_debates_usage_nonnegative" CHECK ("tts_characters" >= 0 and "stt_requests" >= 0 and "prompt_tokens" >= 0 and "completion_tokens" >= 0),
	CONSTRAINT "ai_debates_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE INDEX "ai_debates_actor_created_idx" ON "ai_debates" ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_debates_live_idx" ON "ai_debates" ("expected_end_at") WHERE "finished_at" is null;--> statement-breakpoint
ALTER TABLE "ai_debate_ballots" ADD CONSTRAINT "ai_debate_ballots_ai_debate_id_ai_debates_id_fkey" FOREIGN KEY ("ai_debate_id") REFERENCES "ai_debates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_debate_commands" ADD CONSTRAINT "ai_debate_commands_ai_debate_id_ai_debates_id_fkey" FOREIGN KEY ("ai_debate_id") REFERENCES "ai_debates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_debate_utterances" ADD CONSTRAINT "ai_debate_utterances_ai_debate_id_ai_debates_id_fkey" FOREIGN KEY ("ai_debate_id") REFERENCES "ai_debates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_debates" ADD CONSTRAINT "ai_debates_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;
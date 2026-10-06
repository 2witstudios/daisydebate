CREATE TABLE "debate_documents" (
	"id" text PRIMARY KEY,
	"owner_user_id" text NOT NULL,
	"ai_debate_id" text,
	"folder" text NOT NULL,
	"template_id" text NOT NULL,
	"title" text NOT NULL,
	"html" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debate_documents_folder_check" CHECK ("folder" in ('round', 'library')),
	CONSTRAINT "debate_documents_round_has_debate" CHECK (("folder" = 'round') = ("ai_debate_id" is not null)),
	CONSTRAINT "debate_documents_title_length" CHECK (char_length("title") between 1 and 120),
	CONSTRAINT "debate_documents_revision_positive" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE INDEX "debate_documents_owner_ai_debate_idx" ON "debate_documents" ("owner_user_id","ai_debate_id");--> statement-breakpoint
CREATE INDEX "debate_documents_owner_folder_idx" ON "debate_documents" ("owner_user_id","folder");--> statement-breakpoint
CREATE INDEX "debate_documents_ai_debate_idx" ON "debate_documents" ("ai_debate_id");--> statement-breakpoint
ALTER TABLE "debate_documents" ADD CONSTRAINT "debate_documents_owner_user_id_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "debate_documents" ADD CONSTRAINT "debate_documents_ai_debate_id_ai_debates_id_fkey" FOREIGN KEY ("ai_debate_id") REFERENCES "ai_debates"("id") ON DELETE CASCADE;
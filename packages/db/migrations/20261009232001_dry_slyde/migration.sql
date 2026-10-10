CREATE TABLE "messaging_social_command_subjects" (
	"actor_id" text,
	"request_id" text,
	"subject_actor_id" text,
	CONSTRAINT "messaging_social_command_subjects_pkey" PRIMARY KEY("actor_id","request_id","subject_actor_id")
);
--> statement-breakpoint
CREATE INDEX "messaging_social_command_subjects_subject_idx" ON "messaging_social_command_subjects" ("subject_actor_id");--> statement-breakpoint
ALTER TABLE "messaging_social_command_subjects" ADD CONSTRAINT "messaging_social_command_subjects_oeE7csZU5u6E_fkey" FOREIGN KEY ("subject_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_social_command_subjects" ADD CONSTRAINT "messaging_social_command_subjects_command_fk" FOREIGN KEY ("actor_id","request_id") REFERENCES "messaging_social_commands"("actor_id","request_id") ON DELETE CASCADE;
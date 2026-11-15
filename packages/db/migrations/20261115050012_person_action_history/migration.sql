ALTER TABLE "action_history" DROP CONSTRAINT "action_history_one_tenant_key";--> statement-breakpoint
ALTER TABLE "action_history" ADD COLUMN "subject_person_user_id" text;--> statement-breakpoint
CREATE INDEX "action_history_subject_person_idx" ON "action_history" ("subject_person_user_id","applied_at");--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_subject_person_user_id_users_id_fkey" FOREIGN KEY ("subject_person_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_one_scope" CHECK (num_nonnulls("organization_id", "lobby_id", "subject_person_user_id") = 1);
--> statement-breakpoint
DROP POLICY "action_history_scope" ON "action_history";
--> statement-breakpoint
CREATE POLICY "action_history_scope" ON "action_history" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()) OR ((subject_person_user_id = daisy_subject_scope()) AND (daisy_organization_scope() IS NULL) AND (daisy_lobby_scope() IS NULL))) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()) OR ((subject_person_user_id = daisy_subject_scope()) AND (daisy_organization_scope() IS NULL) AND (daisy_lobby_scope() IS NULL)));
--> statement-breakpoint

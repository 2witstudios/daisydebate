CREATE INDEX "messaging_actor_states_actor_idx" ON "messaging_actor_states" ("actor_id");--> statement-breakpoint
CREATE INDEX "messaging_messages_author_idx" ON "messaging_messages" ("author_actor_id");--> statement-breakpoint
CREATE INDEX "messaging_messages_reply_channel_idx" ON "messaging_messages" ("reply_to_message_id","channel_id");--> statement-breakpoint
CREATE INDEX "messaging_reactions_actor_idx" ON "messaging_reactions" ("actor_id");--> statement-breakpoint
CREATE INDEX "messaging_reactions_message_channel_idx" ON "messaging_reactions" ("message_id","channel_id");--> statement-breakpoint
CREATE INDEX "messaging_receipts_channel_idx" ON "messaging_receipts" ("channel_id");--> statement-breakpoint
CREATE INDEX "messaging_receipts_message_channel_idx" ON "messaging_receipts" ("message_id","channel_id");--> statement-breakpoint
CREATE INDEX "messaging_contact_pairs_high_actor_idx" ON "messaging_contact_pairs" ("high_actor_id");--> statement-breakpoint
CREATE INDEX "messaging_dm_pairs_high_actor_idx" ON "messaging_dm_pairs" ("high_actor_id");--> statement-breakpoint
CREATE INDEX "messaging_dm_pairs_channel_kind_idx" ON "messaging_dm_pairs" ("channel_id","channel_kind");--> statement-breakpoint
CREATE INDEX "messaging_group_grants_actor_idx" ON "messaging_group_grants" ("actor_id");--> statement-breakpoint
CREATE INDEX "messaging_group_grants_channel_kind_idx" ON "messaging_group_grants" ("channel_id","channel_kind");--> statement-breakpoint
CREATE INDEX "messaging_group_invitations_invitee_idx" ON "messaging_group_invitations" ("invitee_actor_id");--> statement-breakpoint
CREATE INDEX "messaging_group_invitations_inviter_idx" ON "messaging_group_invitations" ("invited_by_actor_id");--> statement-breakpoint
CREATE INDEX "messaging_group_invitations_channel_kind_idx" ON "messaging_group_invitations" ("channel_id","channel_kind");--> statement-breakpoint
CREATE INDEX "messaging_social_commands_result_channel_idx" ON "messaging_social_commands" ("result_channel_id");
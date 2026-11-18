CREATE TABLE "tournament_hosting_purchases" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"payer_user_id" text NOT NULL,
	"tier" text NOT NULL,
	"amount" integer NOT NULL,
	"mode" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"vendor_session_id" text,
	"vendor_payment_intent_id" text,
	"receipt_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "tournament_hosting_purchases_tier_check" CHECK ("tier" in ('event_64', 'event_unlimited')),
	CONSTRAINT "tournament_hosting_purchases_state_check" CHECK ("state" in ('open', 'paid', 'expired')),
	CONSTRAINT "tournament_hosting_purchases_mode_check" CHECK ("mode" in ('test', 'live')),
	CONSTRAINT "tournament_hosting_purchases_amount_check" CHECK ("amount" > 0 and "amount" <= 19900),
	CONSTRAINT "tournament_hosting_purchases_identity_check" CHECK ("id" ~ '^[a-z0-9]{24}$'
    and ("vendor_session_id" is null or ("vendor_session_id" ~ '^cs_(test|live)_[A-Za-z0-9]+$' and length("vendor_session_id") <= 255))
    and ("vendor_payment_intent_id" is null or ("vendor_payment_intent_id" ~ '^pi_[A-Za-z0-9]+$' and length("vendor_payment_intent_id") <= 255))
    and ("receipt_url" is null or ("receipt_url" ~ '^https://pay[.]stripe[.]com/receipts/' and length("receipt_url") <= 2048))),
	CONSTRAINT "tournament_hosting_purchases_lifecycle_check" CHECK (case "state"
    when 'open' then "paid_at" is null and "expired_at" is null
    when 'paid' then "paid_at" is not null and "expired_at" is null and "vendor_session_id" is not null and "vendor_payment_intent_id" is not null
    when 'expired' then "paid_at" is null and "expired_at" is not null
    else false end)
);
--> statement-breakpoint
CREATE INDEX "tournament_hosting_purchases_lobby_idx" ON "tournament_hosting_purchases" ("lobby_id","created_at");--> statement-breakpoint
CREATE INDEX "tournament_hosting_purchases_payer_idx" ON "tournament_hosting_purchases" ("payer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_hosting_purchases_open_unique" ON "tournament_hosting_purchases" ("lobby_id") WHERE "state" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_hosting_purchases_session_unique" ON "tournament_hosting_purchases" ("mode","vendor_session_id");--> statement-breakpoint
ALTER TABLE "tournament_hosting_purchases" ADD CONSTRAINT "tournament_hosting_purchases_lobby_id_tournaments_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "tournaments"("lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_hosting_purchases" ADD CONSTRAINT "tournament_hosting_purchases_payer_user_id_users_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_key_check", ADD CONSTRAINT "settings_key_check" CHECK ("key" in ('pairing.preset', 'pairing.method', 'pairing.section_size', 'pairing.rematch', 'pairing.same_school', 'pairing.side_balance', 'pairing.side_alternation', 'pairing.pull_up', 'pairing.position_balance', 'pairing.section_repeat', 'pairing.preference_order', 'bye.recipient', 'bye.result', 'bye.repeat', 'judging.panel', 'judging.availability', 'judging.strike', 'judging.conflict', 'judging.same_school', 'judging.repeat_judge', 'judging.unsubmitted_ballot', 'judging.load_balance', 'judging.chair', 'judging.panel_same_school', 'judging.preference_order', 'standings.tiebreaks', 'standings.rating_ladder', 'break.line', 'break.seeding', 'break.double_qualifier', 'entry.divisions', 'entry.registration', 'entry.approval', 'entry.cap', 'entry.judge_obligation', 'conflict.handling', 'recording.capture', 'judging.ai_judge', 'broadcast.live', 'audience.posting', 'audience.decision', 'audience.scores', 'audience.reason', 'audience.feedback', 'audience.video', 'ballot.screening', 'resolution.rule', 'resolution.own_text', 'room.own_format', 'room.visibility', 'room.timing', 'room.floor', 'staff.minimum_band'));--> statement-breakpoint
ALTER TABLE "tournament_hosting_purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tournament_hosting_purchases_scope" ON "tournament_hosting_purchases" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
REVOKE DELETE ON tournament_hosting_purchases FROM daisy_web;

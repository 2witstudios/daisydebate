CREATE TABLE "flag_account_overrides" (
	"key" text,
	"user_id" text,
	"enabled" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flag_account_overrides_pkey" PRIMARY KEY("key","user_id"),
	CONSTRAINT "flag_account_overrides_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE TABLE "flag_change_events" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL,
	"revision" integer NOT NULL,
	"command_id" text NOT NULL,
	"change" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flag_change_events_change_check" CHECK ("change" in ('state', 'override')),
	CONSTRAINT "flag_change_events_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "release_flags" (
	"key" text PRIMARY KEY,
	"state" text NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "release_flags_key_check" CHECK ("key" ~ '^[a-z][a-z0-9-]{1,63}$'),
	CONSTRAINT "release_flags_state_check" CHECK ("state" in ('default', 'enabled', 'disabled', 'killed')),
	CONSTRAINT "release_flags_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE INDEX "flag_account_overrides_user_idx" ON "flag_account_overrides" ("user_id");--> statement-breakpoint
CREATE INDEX "flag_account_overrides_expiry_idx" ON "flag_account_overrides" ("expires_at");--> statement-breakpoint
CREATE INDEX "flag_change_events_key_idx" ON "flag_change_events" ("key","revision");--> statement-breakpoint
CREATE INDEX "flag_change_events_created_idx" ON "flag_change_events" ("created_at");--> statement-breakpoint
ALTER TABLE "flag_account_overrides" ADD CONSTRAINT "flag_account_overrides_key_release_flags_key_fkey" FOREIGN KEY ("key") REFERENCES "release_flags"("key");--> statement-breakpoint
ALTER TABLE "flag_account_overrides" ADD CONSTRAINT "flag_account_overrides_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON release_flags TO daisy_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON flag_account_overrides TO daisy_web;
GRANT SELECT, INSERT ON flag_change_events TO daisy_web;
REVOKE UPDATE, DELETE ON flag_change_events FROM daisy_web;
--> statement-breakpoint
-- Only the closed-account privacy path may remove a Flags command's target link.
-- Ordinary commands cannot edit or delete audit; erasure is a scoped exception.
CREATE FUNCTION public.daisy_erase_flag_subject(subject_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = subject_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'account must be closed' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(59118, 1);
  DELETE FROM public.flag_change_events WHERE command_id IN (
    SELECT command_id FROM public.operator_command_receipts
    WHERE target_user_id = subject_id AND action IN ('flag.state.update', 'flag.override.update')
  );
  DELETE FROM public.operator_command_receipts
    WHERE target_user_id = subject_id AND action IN ('flag.state.update', 'flag.override.update');
END;
$$;
REVOKE ALL ON FUNCTION public.daisy_erase_flag_subject(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_erase_flag_subject(text) TO daisy_web;
--> statement-breakpoint
-- Bounded audit retention. The caller can shorten a batch, never shorten 90 days.
CREATE FUNCTION public.daisy_purge_flag_evidence(before_time timestamptz, batch_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ids text[]; removed integer;
BEGIN
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 500 OR before_time IS NULL THEN
    RAISE EXCEPTION 'invalid retention bound' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(59118, 1);
  SELECT array_agg(command_id) INTO ids FROM (
    SELECT command_id FROM public.operator_command_receipts
    WHERE action IN ('flag.state.update', 'flag.override.update')
      AND created_at <= least(before_time, clock_timestamp() - interval '90 days')
    ORDER BY created_at, command_id LIMIT batch_limit
  ) due;
  DELETE FROM public.flag_change_events WHERE command_id = ANY(ids);
  DELETE FROM public.operator_command_receipts WHERE command_id = ANY(ids);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.daisy_purge_flag_evidence(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_purge_flag_evidence(timestamptz, integer) TO daisy_web;

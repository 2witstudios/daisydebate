--> daisy_media_worker: the capture worker's only credential (ADR 0053,
--> VIDEO-3.13). SELECT on the capture authority it discovers sessions from
--> and on the lease table, so discovery skips live leases. No write anywhere:
--> leases, utterances, observations and seals change only through the signed
--> apps/web path, under the Round -> lease -> stream lock order. Explicit
--> grants only: default privileges never reach it. No password is set;
--> production provisions the credential out of band (VIDEO-4.2).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_media_worker') THEN
    CREATE ROLE daisy_media_worker LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_media_worker;
--> statement-breakpoint
GRANT SELECT ON rounds, round_participants, round_segments, media_sessions, media_participants, media_worker_leases TO daisy_media_worker;

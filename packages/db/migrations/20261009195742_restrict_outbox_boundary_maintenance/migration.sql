-- Remove baseline-inherited table DML before granting the exact maintenance surface.
REVOKE ALL PRIVILEGES ON public.outbox_retention_boundary FROM daisy_web, daisy_realtime, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.outbox_retention_boundary TO daisy_web, daisy_realtime;
--> statement-breakpoint
GRANT UPDATE (txid, seq) ON public.outbox_retention_boundary TO daisy_web;

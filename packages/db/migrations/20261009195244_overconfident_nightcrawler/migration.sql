CREATE TABLE "outbox_retention_boundary" (
	"singleton" boolean PRIMARY KEY,
	"txid" xid8 NOT NULL,
	"seq" bigint NOT NULL,
	CONSTRAINT "outbox_retention_boundary_singleton" CHECK ("singleton" = true),
	CONSTRAINT "outbox_retention_boundary_seq" CHECK ("seq" >= 0)
);

--> statement-breakpoint
-- Deny all unknown pre-migration history, including an empty previously-pruned log.
INSERT INTO public.outbox_retention_boundary(singleton, txid, seq) VALUES (true, pg_current_xact_id(), 0);
--> statement-breakpoint
GRANT SELECT ON public.outbox_retention_boundary TO daisy_web, daisy_realtime;
--> statement-breakpoint
GRANT UPDATE (txid, seq) ON public.outbox_retention_boundary TO daisy_web;

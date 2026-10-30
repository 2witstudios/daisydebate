ALTER TABLE "published_resolutions" ADD COLUMN "edition" text;--> statement-breakpoint
ALTER TABLE "published_resolutions" ADD COLUMN "theme" text;--> statement-breakpoint
ALTER TABLE "published_resolutions" ADD CONSTRAINT "published_resolutions_edition_check" CHECK ("edition" is null or length(trim("edition")) between 1 and 100);--> statement-breakpoint
ALTER TABLE "published_resolutions" ADD CONSTRAINT "published_resolutions_theme_check" CHECK ("theme" is null or length(trim("theme")) between 1 and 200);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_preserve_published_resolution() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Published resolutions are immutable' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW) - 'retired_at') IS DISTINCT FROM (to_jsonb(OLD) - 'retired_at')
     OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL THEN
    RAISE EXCEPTION 'Only one-way retirement is allowed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
UPDATE public.published_resolutions SET retired_at=statement_timestamp()
WHERE retired_at IS NULL AND kind IN ('policy','value');
--> statement-breakpoint
INSERT INTO public.published_resolutions (id,kind,text,provenance,edition,theme) VALUES
('s3vycbr7v7fl6a2xzmgneize','policy','Resolved: Competitive debate should be a mandatory component of the core curriculum in American public education.','Owner-confirmed Daisy Beta Season 1 (2026-10-29)','Beta Season 1','Education and institutional adoption'),
('d3qrq2srlk8wpa3qhzefly0y','value','Resolved: The world would be a better place if traditional sports were replaced by competitive debate.','Owner-confirmed Daisy Beta Season 1 (2026-10-29)','Beta Season 1','Culture and social priorities');

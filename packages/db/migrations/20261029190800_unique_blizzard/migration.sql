CREATE TABLE "published_resolutions" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"provenance" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "published_resolutions_kind_check" CHECK ("kind" in ('policy', 'value')),
	CONSTRAINT "published_resolutions_text_check" CHECK (length(trim("text")) between 1 and 300),
	CONSTRAINT "published_resolutions_provenance_check" CHECK (length(trim("provenance")) > 0),
	CONSTRAINT "published_resolutions_retirement_check" CHECK ("retired_at" is null or "retired_at" >= "published_at")
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "published_resolution_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "published_resolutions_current_kind" ON "published_resolutions" ("kind") WHERE "retired_at" is null;--> statement-breakpoint
CREATE INDEX "rooms_published_resolution_idx" ON "rooms" ("published_resolution_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_published_resolution_id_published_resolutions_id_fkey" FOREIGN KEY ("published_resolution_id") REFERENCES "published_resolutions"("id") ON DELETE RESTRICT;
--> statement-breakpoint
INSERT INTO public.published_resolutions (id,kind,text,provenance)
SELECT 'g0c8gv3cg20oee0g5pvifxeu','policy',text,'Daisy-original resolution bank revision 1: ' || id
FROM public.resolution_bank_entries WHERE id='pryied8jvkvrn7g0p60iv632';
--> statement-breakpoint
INSERT INTO public.published_resolutions (id,kind,text,provenance)
SELECT 'se5d9pwcwp7cbvb0fi7mku4a','value',text,'Daisy-original resolution bank revision 1: ' || id
FROM public.resolution_bank_entries WHERE id='b6b9yjq40xv9kmbvy4kwxahn';
--> statement-breakpoint
CREATE FUNCTION public.daisy_preserve_published_resolution() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Published resolutions are immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.id,NEW.kind,NEW.text,NEW.provenance,NEW.published_at) IS DISTINCT FROM
     (OLD.id,OLD.kind,OLD.text,OLD.provenance,OLD.published_at)
     OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL THEN
    RAISE EXCEPTION 'Only one-way retirement is allowed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER published_resolutions_immutable BEFORE UPDATE OR DELETE ON public.published_resolutions
FOR EACH ROW EXECUTE FUNCTION public.daisy_preserve_published_resolution();
--> statement-breakpoint
GRANT SELECT ON public.published_resolutions TO daisy_web,daisy_realtime;
--> statement-breakpoint
CREATE FUNCTION public.daisy_current_published_resolution(selected_id text,selected_kind text)
RETURNS SETOF public.published_resolutions LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
 SELECT * FROM public.published_resolutions
 WHERE id=selected_id AND kind=selected_kind AND retired_at IS NULL FOR SHARE
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_current_published_resolution(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_current_published_resolution(text,text) TO daisy_web;

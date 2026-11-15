CREATE TABLE "fixture_room_sources" (
	"room_id" text PRIMARY KEY,
	"fixture_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fixture_room_sources_fixture_idx" ON "fixture_room_sources" ("fixture_id","lobby_id");--> statement-breakpoint
CREATE INDEX "fixture_room_sources_room_lobby_idx" ON "fixture_room_sources" ("room_id","lobby_id");--> statement-breakpoint
CREATE INDEX "fixture_room_sources_lobby_idx" ON "fixture_room_sources" ("lobby_id");--> statement-breakpoint
ALTER TABLE "fixture_room_sources" ADD CONSTRAINT "fixture_room_sources_fixture_fk" FOREIGN KEY ("fixture_id","lobby_id") REFERENCES "fixtures"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fixture_room_sources" ADD CONSTRAINT "fixture_room_sources_room_fk" FOREIGN KEY ("room_id","lobby_id") REFERENCES "rooms"("id","lobby_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE public.fixture_room_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fixture_room_sources_scope ON public.fixture_room_sources FOR ALL
 USING (lobby_id=daisy_lobby_scope()) WITH CHECK (lobby_id=daisy_lobby_scope());
--> statement-breakpoint
-- This copies only the existing real foreign-key relationship, not a reconstructed command history.
INSERT INTO public.fixture_room_sources(room_id,fixture_id,lobby_id)
 SELECT room_id,id,lobby_id FROM public.fixtures WHERE room_id IS NOT NULL;
--> statement-breakpoint
REVOKE INSERT,UPDATE,DELETE ON public.fixture_room_sources FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_fixture_room_source_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'A fixture Room source cannot be rewritten'
 USING ERRCODE='23514',CONSTRAINT='fixture_room_sources_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fixture_room_sources_immutable BEFORE UPDATE OR DELETE ON public.fixture_room_sources
 FOR EACH ROW EXECUTE FUNCTION public.daisy_fixture_room_source_immutable();
--> statement-breakpoint
CREATE FUNCTION public.daisy_record_fixture_room_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.room_id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.fixture_room_sources(room_id,fixture_id,lobby_id)
 VALUES(NEW.room_id,NEW.id,NEW.lobby_id) ON CONFLICT(room_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.fixture_room_sources
  WHERE room_id=NEW.room_id AND fixture_id=NEW.id AND lobby_id=NEW.lobby_id) THEN
  RAISE EXCEPTION 'A Room cannot acquire another fixture source'
   USING ERRCODE='23514',CONSTRAINT='fixture_room_sources_original_fixture';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_record_fixture_room_source() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER fixtures_record_room_source AFTER INSERT OR UPDATE OF room_id ON public.fixtures
 FOR EACH ROW EXECUTE FUNCTION public.daisy_record_fixture_room_source();

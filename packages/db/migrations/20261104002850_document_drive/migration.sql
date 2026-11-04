CREATE TABLE "document_folders" (
	"id" text PRIMARY KEY,
	"owner_actor_id" text NOT NULL,
	"parent_folder_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_folders_owner_id_unique" UNIQUE("owner_actor_id","id"),
	CONSTRAINT "document_folders_name_length" CHECK (char_length("name") between 1 and 120),
	CONSTRAINT "document_folders_not_own_parent" CHECK ("parent_folder_id" is distinct from "id")
);
--> statement-breakpoint
DROP INDEX "documents_owner_created_idx";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, title), 'A') || setweight(to_tsvector('simple'::regconfig, html), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "document_folders_listing_idx" ON "document_folders" ("owner_actor_id","parent_folder_id","name","id");--> statement-breakpoint
CREATE INDEX "documents_listing_idx" ON "documents" ("owner_actor_id","folder_id","title","id");--> statement-breakpoint
CREATE INDEX "documents_owner_edited_idx" ON "documents" ("owner_actor_id","updated_at");--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "documents" USING gin ("search");--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_owner_actor_id_actors_id_fkey" FOREIGN KEY ("owner_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_parent_fk" FOREIGN KEY ("owner_actor_id","parent_folder_id") REFERENCES "document_folders"("owner_actor_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_fk" FOREIGN KEY ("owner_actor_id","folder_id") REFERENCES "document_folders"("owner_actor_id","id") ON DELETE CASCADE;
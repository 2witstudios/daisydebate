CREATE TABLE "seed_versions" (
	"seed_name" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

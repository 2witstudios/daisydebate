CREATE TABLE "messaging_file_deletion_intents" (
	"object_key" text PRIMARY KEY,
	"charged_bytes" bigint NOT NULL,
	CONSTRAINT "messaging_file_deletion_intents_bytes" CHECK ("charged_bytes" between 1 and 9007199254740991)
);

DROP TABLE "round_document_refs";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_folder_check";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_template_check";--> statement-breakpoint
DROP INDEX "documents_owner_folder_idx";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "template_id";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "folder";
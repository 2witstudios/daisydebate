ALTER TABLE "necessary_evidence" ADD COLUMN "original_subject_actor_ids" text[];--> statement-breakpoint
CREATE INDEX "necessary_evidence_subjects_idx" ON "necessary_evidence" USING gin ("original_subject_actor_ids");--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_subjects_check" CHECK ("original_subject_actor_ids" is null or (
      cardinality("original_subject_actor_ids") between 0 and 257 and (cardinality("original_subject_actor_ids")=0 or (
        array_ndims("original_subject_actor_ids")=1 and array_lower("original_subject_actor_ids",1)=1
        and array_position("original_subject_actor_ids",null) is null
        and array_to_string("original_subject_actor_ids",',') ~ '^[a-z0-9]{24}(,[a-z0-9]{24})*$'
      ))));
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_report_is_object";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_status_check";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_attempts_check";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_result_check";--> statement-breakpoint
DROP INDEX "round_analyses_lease_idx";--> statement-breakpoint
-- Offline cutover: all old analysis/web processes must be drained and terminated
-- before this transaction; removing a database lease cannot stop their provider I/O.
ALTER TABLE "round_analyses" ADD COLUMN "work" jsonb;
--> statement-breakpoint
-- Preserve observed facts, not invented opt-in, dispatch, outcome or allowance use.
-- Old claims bound possible calls; even positive aggregate tokens do not resolve every claim.
UPDATE round_analyses SET work = jsonb_build_object(
  'kind', CASE status WHEN 'succeeded' THEN 'retained' WHEN 'failed' THEN 'retired' ELSE 'unrequested' END,
  'historical', jsonb_build_object(
    'createdAt', created_at, 'completedAt', completed_at,
    'claimedAttempts', attempts, 'model', model,
    'inputTokens', input_tokens, 'outputTokens', output_tokens
  )
) || CASE status
  WHEN 'succeeded' THEN jsonb_build_object('report',report)
  WHEN 'failed' THEN jsonb_build_object('reason',CASE WHEN model='erased' THEN 'erased' ELSE 'failed' END)
  ELSE '{}'::jsonb END
WHERE work IS NULL;
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "round_analyses" ALTER COLUMN "work" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_lease_check";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "attempts";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "lease_token_digest";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "lease_expires_at";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "model";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "report";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "input_tokens";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "output_tokens";--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "completed_at";--> statement-breakpoint
CREATE INDEX "round_analyses_pending_idx" ON "round_analyses" (("work"->>'kind'),("work"->>'requestedAt'),"round_participant_id");--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_work_is_object" CHECK (jsonb_typeof("work") = 'object');--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_freeze_revision_check" CHECK ("freeze_revision" > 0);--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_work_kind_check" CHECK (coalesce("work"->>'kind' in ('unrequested','retained','retired','queued','leased','succeeded','failed','purged'),false));--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_history_check" CHECK (coalesce(("work"->'historical')='null'::jsonb or (
        jsonb_typeof(("work"->'historical'))='object'
        and ("work"->'historical') ?& array['createdAt','completedAt','claimedAttempts','model','inputTokens','outputTokens']
        and ("work"->'historical')-array['createdAt','completedAt','claimedAttempts','model','inputTokens','outputTokens']='{}'::jsonb
        and (("work"->'historical')->>'createdAt')::timestamptz="created_at"
        and isfinite((("work"->'historical')->>'createdAt')::timestamptz)
        and (("work"->'historical')->'completedAt'='null'::jsonb or (isfinite((("work"->'historical')->>'completedAt')::timestamptz) and (("work"->'historical')->>'completedAt')::timestamptz>="created_at"))
        and (jsonb_typeof(("work"->'historical')->'claimedAttempts')='number' and (("work"->'historical')->'claimedAttempts')::text ~ '^(0|[1-9][0-9]*)$' and (("work"->'historical')->'claimedAttempts')::numeric<=9007199254740991)
        and (jsonb_typeof(("work"->'historical')->'inputTokens')='number' and (("work"->'historical')->'inputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (("work"->'historical')->'inputTokens')::numeric<=9007199254740991)
        and (jsonb_typeof(("work"->'historical')->'outputTokens')='number' and (("work"->'historical')->'outputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (("work"->'historical')->'outputTokens')::numeric<=9007199254740991)
        and jsonb_typeof(("work"->'historical')->'model')='string' and length(("work"->'historical')->>'model')>0
      ),false));--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_request_check" CHECK (coalesce((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)='null'::jsonb or (jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end))='object'
    and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end) ?& array['requestId','requestedAt','deadlineAt','evidenceLines','claims','calls']
    and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)-array['requestId','requestedAt','deadlineAt','evidenceLines','claims','calls']='{}'::jsonb
    and jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'requestedAt')='string' and jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'deadlineAt')='string'
    and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestId' ~ '^[a-z][a-z0-9]{23}$'
    and isfinite(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz)
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'deadlineAt')::timestamptz=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz+interval '15 minutes'
    and (jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'evidenceLines')='number' and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'evidenceLines')::text ~ '^(0|[1-9][0-9]*)$' and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'evidenceLines')::numeric<=9007199254740991) and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'evidenceLines')::integer>0
    and (jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'claims')='number' and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'claims')::text ~ '^(0|[1-9][0-9]*)$' and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'claims')::numeric<=9007199254740991) and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'claims')::integer between 0 and 4
    and jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')='array' and jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<=2
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'claims')::integer>=jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')
    and (jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<1 or (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0))='object'
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0) ?& array['id','tokenDigest','model','dispatchedAt','outcome']
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)-array['id','tokenDigest','model','dispatchedAt','outcome']='{}'::jsonb
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'id' ~ '^[a-z][a-z0-9]{23}$'
    and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'dispatchedAt')='string' and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'tokenDigest')='string'
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'tokenDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'model')='string' and length(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'model')>0
    and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'dispatchedAt')::timestamptz>=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz
    and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'dispatchedAt')::timestamptz<((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'deadlineAt')::timestamptz
    and case ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->>'kind'
      when 'unknown' then ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'='{"kind":"unknown"}'::jsonb
      when 'definite_failure' then ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'='{"kind":"definite_failure"}'::jsonb
      when 'received' then (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome')-array['kind','inputTokens','outputTokens']='{}'::jsonb and (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'inputTokens')='number' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'inputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'inputTokens')::numeric<=9007199254740991) and (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'outputTokens')='number' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'outputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'outputTokens')::numeric<=9007199254740991)
      else false end))
    and (jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<2 or (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1))='object'
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1) ?& array['id','tokenDigest','model','dispatchedAt','outcome']
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)-array['id','tokenDigest','model','dispatchedAt','outcome']='{}'::jsonb
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'id' ~ '^[a-z][a-z0-9]{23}$'
    and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'dispatchedAt')='string' and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'tokenDigest')='string'
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'tokenDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'model')='string' and length(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'model')>0
    and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'dispatchedAt')::timestamptz>=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz
    and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'dispatchedAt')::timestamptz<((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'deadlineAt')::timestamptz
    and case ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->>'kind'
      when 'unknown' then ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'='{"kind":"unknown"}'::jsonb
      when 'definite_failure' then ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'='{"kind":"definite_failure"}'::jsonb
      when 'received' then (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome')-array['kind','inputTokens','outputTokens']='{}'::jsonb and (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'inputTokens')='number' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'inputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'inputTokens')::numeric<=9007199254740991) and (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'outputTokens')='number' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'outputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'outputTokens')::numeric<=9007199254740991)
      else false end
      and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0->>'id'<>(case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1->>'id'
      and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0->>'tokenDigest'<>(case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1->>'tokenDigest'))
        and (("work"->'historical')='null'::jsonb or (("work"->'historical')->'completedAt'='null'::jsonb and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz>="created_at"))
        and coalesce((("work"->'historical')->>'claimedAttempts')::integer,0)+jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<=2
        and (not ("work"->>'kind'='queued') or (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'claims')::integer<4 and coalesce((("work"->'historical')->>'claimedAttempts')::integer,0)+jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<2))
      ),false));--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_work_authority_check" CHECK (coalesce(case "work"->>'kind'
        when 'unrequested' then jsonb_typeof(("work"->'historical'))='object' and ("work"->'historical')->'completedAt'='null'::jsonb and "work"-array['kind','historical']='{}'::jsonb
        when 'retained' then jsonb_typeof(("work"->'historical'))='object' and ("work"->'historical')->'completedAt'<>'null'::jsonb and jsonb_typeof("work"->'report')='object' and "work"-array['kind','historical','report']='{}'::jsonb
        when 'retired' then jsonb_typeof(("work"->'historical'))='object' and ("work"->'historical')->'completedAt'<>'null'::jsonb and "work"->>'reason' in ('failed','erased') and "work"-array['kind','historical','reason']='{}'::jsonb
        when 'purged' then "work" ?& array['request','purgedAt','completedAt','historical'] and "work"-array['kind','request','purgedAt','completedAt','historical']='{}'::jsonb
          and (("work"->'historical')<>'null'::jsonb or (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)<>'null'::jsonb)
          and isfinite(("work"->>'purgedAt')::timestamptz)
          and ("work"->>'purgedAt')::timestamptz>=coalesce(("work"->>'completedAt')::timestamptz,((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz,"created_at")
        else (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)<>'null'::jsonb and "work" ? 'historical'
          and (("work"->>'kind'='leased') = ("work" ? 'lease'))
          and (("work"->>'kind'='succeeded') = ("work" ? 'report'))
          and (("work"->>'kind' in ('failed','succeeded')) = ("work" ? 'completedAt'))
          and (("work"->>'kind'='failed') = ("work" ? 'reason'))
          and (not ("work"->>'kind'='failed') or "work"->>'reason' in ('exhausted','authority','evidence','expired'))
          and (not ("work" ? 'completedAt') or (isfinite(("work"->>'completedAt')::timestamptz) and ("work"->>'completedAt')::timestamptz>=("work"->>'requestedAt')::timestamptz))
          and (not ("work"->>'kind'='succeeded') or (jsonb_typeof("work"->'report')='object' and ("work"->>'completedAt')::timestamptz<("work"->>'deadlineAt')::timestamptz and ("work"->'calls'->0->'outcome'->>'kind'='received' or "work"->'calls'->1->'outcome'->>'kind'='received')))
      end,false));--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_lease_check" CHECK (coalesce("work"->>'kind'<>'leased' or (jsonb_typeof(("work"->'lease'))='object'
    and ("work"->'lease') ?& array['callId','tokenDigest','model','claimedAt','expiresAt']
    and ("work"->'lease')-array['callId','tokenDigest','model','claimedAt','expiresAt']='{}'::jsonb
    and jsonb_typeof(("work"->'lease')->'claimedAt')='string' and jsonb_typeof(("work"->'lease')->'expiresAt')='string' and jsonb_typeof(("work"->'lease')->'tokenDigest')='string'
    and ("work"->'lease')->>'callId' ~ '^[a-z][a-z0-9]{23}$' and ("work"->'lease')->>'tokenDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(("work"->'lease')->'model')='string' and length(("work"->'lease')->>'model')>0
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'claims')::integer>0
    and (("work"->'lease')->>'claimedAt')::timestamptz>=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz
    and (("work"->'lease')->>'expiresAt')::timestamptz>(("work"->'lease')->>'claimedAt')::timestamptz
    and (("work"->'lease')->>'expiresAt')::timestamptz<=(("work"->'lease')->>'claimedAt')::timestamptz+interval '3 minutes'
    and (("work"->'lease')->>'expiresAt')::timestamptz<=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'deadlineAt')::timestamptz),false));
--> statement-breakpoint
-- Runtime cannot delete a seat identity to obtain a new historical or lifetime budget.
REVOKE DELETE ON round_analyses FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION guard_analysis_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_request jsonb;
  next_request jsonb;
  old_call jsonb;
  next_call jsonb;
  previous_calls integer;
  next_calls integer;
  previous_claims integer;
  next_claims integer;
  ordinal integer;
BEGIN
  next_request := CASE WHEN NEW.work->>'kind'='purged' THEN NEW.work->'request'
    WHEN NEW.work ? 'requestedAt' THEN NEW.work-array['kind','historical','lease','report','reason','completedAt'] ELSE 'null'::jsonb END;
  IF TG_OP='INSERT' THEN
    IF NEW.work->>'kind' IS DISTINCT FROM 'queued' OR NEW.work->'historical' IS DISTINCT FROM 'null'::jsonb
      OR next_request->'claims' IS DISTINCT FROM '0'::jsonb OR next_request->'calls' IS DISTINCT FROM '[]'::jsonb
      OR (next_request->>'requestedAt')::timestamptz>clock_timestamp() THEN
      RAISE EXCEPTION 'analysis starts with a new uncounted request' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.round_id,NEW.round_participant_id,NEW.freeze_revision,NEW.created_at,NEW.work->'historical')
    IS DISTINCT FROM (OLD.round_id,OLD.round_participant_id,OLD.freeze_revision,OLD.created_at,OLD.work->'historical') THEN
    RAISE EXCEPTION 'analysis identity and historical observations are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.work=OLD.work THEN RETURN NEW; END IF;
  previous_request := CASE WHEN OLD.work->>'kind'='purged' THEN OLD.work->'request'
    WHEN OLD.work ? 'requestedAt' THEN OLD.work-array['kind','historical','lease','report','reason','completedAt'] ELSE 'null'::jsonb END;
  IF OLD.work->>'kind' IN ('retained','retired','succeeded','failed','purged')
    AND NEW.work->>'kind' NOT IN (OLD.work->>'kind','purged') THEN
    RAISE EXCEPTION 'terminal analysis cannot reopen' USING ERRCODE='23514';
  END IF;
  IF OLD.work ? 'completedAt' AND NEW.work->'completedAt' IS DISTINCT FROM OLD.work->'completedAt' THEN
    RAISE EXCEPTION 'analysis completion is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.work ? 'purgedAt' AND NEW.work->'purgedAt' IS DISTINCT FROM OLD.work->'purgedAt' THEN
    RAISE EXCEPTION 'analysis purge is terminal' USING ERRCODE='23514';
  END IF;
  IF NEW.work->>'kind'<>'purged' AND (
    (OLD.work ? 'report' AND NEW.work->'report' IS DISTINCT FROM OLD.work->'report') OR
    (OLD.work ? 'reason' AND NEW.work->'reason' IS DISTINCT FROM OLD.work->'reason')) THEN
    RAISE EXCEPTION 'analysis terminal content cannot be replaced' USING ERRCODE='23514';
  END IF;
  IF previous_request='null'::jsonb THEN
    IF next_request<>'null'::jsonb AND (OLD.work->>'kind'<>'unrequested' OR NEW.work->>'kind'<>'queued'
      OR next_request->'claims' IS DISTINCT FROM '0'::jsonb OR next_request->'calls' IS DISTINCT FROM '[]'::jsonb
      OR (next_request->>'requestedAt')::timestamptz>clock_timestamp()) THEN
      RAISE EXCEPTION 'historical analysis requires a fresh uncounted request' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF next_request='null'::jsonb OR next_request-array['claims','calls'] IS DISTINCT FROM previous_request-array['claims','calls'] THEN
    RAISE EXCEPTION 'analysis request admission is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.work->>'kind'='succeeded' AND OLD.work->>'kind'<>'succeeded' THEN
    IF OLD.work->>'kind'<>'leased' OR (OLD.work->'lease'->>'expiresAt')::timestamptz<=clock_timestamp()
      OR (NEW.work->>'completedAt')::timestamptz>clock_timestamp()
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(next_request->'calls') c
        WHERE c->>'id'=OLD.work->'lease'->>'callId' AND c->'outcome'->>'kind'='received') THEN
      RAISE EXCEPTION 'analysis publication requires current received call authority' USING ERRCODE='23514';
    END IF;
  END IF;
  previous_calls := jsonb_array_length(previous_request->'calls');
  next_calls := jsonb_array_length(next_request->'calls');
  previous_claims := (previous_request->>'claims')::integer;
  next_claims := (next_request->>'claims')::integer;
  IF next_claims<previous_claims OR next_claims>previous_claims+1 OR next_calls<previous_calls OR next_calls>previous_calls+1 THEN
    RAISE EXCEPTION 'analysis work cannot reset or skip its budget' USING ERRCODE='23514';
  END IF;
  IF next_claims>previous_claims THEN
    IF NEW.work->>'kind'<>'leased' OR OLD.work->>'kind' NOT IN ('queued','leased') OR next_calls<>previous_calls
      OR (OLD.work->>'kind'='leased' AND (OLD.work->'lease'->>'expiresAt')::timestamptz>clock_timestamp())
      OR (NEW.work->'lease'->>'claimedAt')::timestamptz>clock_timestamp()
      OR (NEW.work->'lease'->>'expiresAt')::timestamptz<=clock_timestamp()
      OR NEW.work->'lease'->>'callId'=OLD.work->'lease'->>'callId'
      OR NEW.work->'lease'->>'tokenDigest'=OLD.work->'lease'->>'tokenDigest'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(previous_request->'calls') c
        WHERE c->>'id'=NEW.work->'lease'->>'callId' OR c->>'tokenDigest'=NEW.work->'lease'->>'tokenDigest') THEN
      RAISE EXCEPTION 'analysis lease requires a new bounded claim' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.work->>'kind'='leased' AND NEW.work->'lease' IS DISTINCT FROM OLD.work->'lease' THEN
    RAISE EXCEPTION 'analysis lease cannot change without a claim' USING ERRCODE='23514';
  END IF;
  FOR ordinal IN 0..previous_calls-1 LOOP
    old_call := previous_request->'calls'->ordinal;
    next_call := next_request->'calls'->ordinal;
    IF next_call-'outcome' IS DISTINCT FROM old_call-'outcome'
      OR (old_call->'outcome'->>'kind'<>'unknown' AND next_call->'outcome' IS DISTINCT FROM old_call->'outcome') THEN
      RAISE EXCEPTION 'analysis dispatch and known provider outcome are immutable' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF next_calls>previous_calls THEN
    next_call := next_request->'calls'->previous_calls;
    IF OLD.work->>'kind'<>'leased' OR NEW.work->>'kind'<>'leased' OR next_claims<>previous_claims
      OR next_call->>'id' IS DISTINCT FROM OLD.work->'lease'->>'callId'
      OR next_call->>'tokenDigest' IS DISTINCT FROM OLD.work->'lease'->>'tokenDigest'
      OR next_call->>'model' IS DISTINCT FROM OLD.work->'lease'->>'model'
      OR next_call->'outcome' IS DISTINCT FROM '{"kind":"unknown"}'::jsonb
      OR (next_call->>'dispatchedAt')::timestamptz<(OLD.work->'lease'->>'claimedAt')::timestamptz
      OR (next_call->>'dispatchedAt')::timestamptz>=(OLD.work->'lease'->>'expiresAt')::timestamptz
      OR (next_call->>'dispatchedAt')::timestamptz>clock_timestamp()
      OR (OLD.work->'lease'->>'expiresAt')::timestamptz<=clock_timestamp() THEN
      RAISE EXCEPTION 'analysis dispatch requires the current lease' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER analysis_identity_immutable BEFORE INSERT OR UPDATE ON round_analyses
FOR EACH ROW EXECUTE FUNCTION guard_analysis_identity();

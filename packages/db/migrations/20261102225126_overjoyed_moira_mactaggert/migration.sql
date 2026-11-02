ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_entitlement_check", ADD CONSTRAINT "account_entitlement_grants_entitlement_check" CHECK ("entitlement" in ('round_analysis', 'ai_rounds', 'casual_ai_judge'));

-- WATCH-16: beta approval grants the casual AI judge until billing exists, so
-- every account already approved holds it, as the beta access command now writes.
INSERT INTO "account_entitlement_grants" ("user_id", "entitlement", "source")
SELECT "user_id", 'casual_ai_judge', 'beta'
FROM "account_beta_access"
WHERE "state" = 'approved';

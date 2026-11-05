ALTER TABLE "account_entitlement_grants" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD CONSTRAINT "account_entitlement_grants_validity_check" CHECK (
      ("source" = 'beta' and "starts_at" is null and "expires_at" is null)
      or ("source" = 'subscription' and "starts_at" is not null and "expires_at" is not null
        and isfinite("starts_at") and isfinite("expires_at") and "starts_at" < "expires_at")
    );--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_source_check", ADD CONSTRAINT "account_entitlement_grants_source_check" CHECK ("source" in ('beta', 'subscription'));
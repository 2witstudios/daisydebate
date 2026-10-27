# 0080: The migration owner is a least-privilege role

Status: accepted (ISSUE-697; orchestrator instruction 2026-10-27 under the
owner's autonomy rule, applied to staging only; production is the owner's
to apply). Supersedes the [ADR 0038](0038-drizzle-1-baseline.md)
consequence that staging and production need `CREATEROLE` on the migration
credential. Refines [ADR 0041](0041-migration-credential-in-a-release-only-app.md).

## Context

`fly postgres attach` creates its login as a cluster superuser, so staging's
migration owner `daisy_migrator` was one. That had three effects:

- The six `SECURITY DEFINER` authorization functions
  (`daisy_authorization_accounts`, `_v2`, `daisy_authorization_age`,
  `daisy_room_read_account`, `_v2`, `daisy_messaging_channel_fence`) ran
  as a superuser for every web request that called them.
- The credential could connect to every database on the cluster, including
  the admin database `daisy_admin` ([ADR 0077](0077-admin-app-architecture.md)),
  which is meant to be closed to every participant role.
- ADR 0038 recorded `CREATEROLE` as a requirement because the baseline
  creates the runtime roles when they are missing.

No migration needs more than ownership. The role-creating statements
(`daisy_web`, `daisy_realtime`, `daisy_media_worker`) are each guarded by
`IF NOT EXISTS (SELECT FROM pg_roles ...)`, so they never run where the role
exists. `btree_gist` is a trusted extension, which a database owner may
create. Schema `public` belongs to `pg_database_owner`, so the database
owner can create in it and grant `USAGE` on it. No migration uses row-level
security, changes an owner, or calls a superuser-only function.

## Decision

1. **The migration owner is a plain login.** It has `NOSUPERUSER NOCREATEDB
NOCREATEROLE NOREPLICATION NOBYPASSRLS`. It owns the participant
   database, and so schema `public`. It also owns schema `drizzle` and every
   object it migrates: tables, indexes, sequences, types, functions and
   `btree_gist`. It has `CONNECT` on no other application database:
   neither `daisy_admin` nor any other database that revokes `CONNECT` from
   PUBLIC. PostgreSQL's default PUBLIC `CONNECT` on the `postgres`, `repmgr`
   and template databases remains, and it owns nothing in them.
2. **Roles are provisioned by the operator, never by a deployed migration.**
   Roles are cluster objects, so creating them needs a cluster privilege.
   The operator creates every runtime role, as superuser `postgres`, before
   the migration that grants to it deploys. This is how the admin roles were
   created (deploy-staging §12). Migrations keep the guarded `CREATE ROLE`,
   so local and CI databases, migrated as the superuser `daisy`, still get
   the roles. In staging and production the guard is a no-op.
3. **A migration that references a new role ships with its provisioning
   step.** The PR that adds the role adds the `CREATE ROLE` step to the
   runbook, and the operator runs it before the merge deploys. If the step
   is missed, the release fails safely: the migration's transaction rolls
   back on `permission denied to create role`, and the web deploy does not
   run.

## Consequences

- The `SECURITY DEFINER` functions run as the table owner, which reads
  everything they read and nothing beyond the participant database.
- Staging applied this on 2026-10-27: `ALTER ROLE daisy_migrator NOSUPERUSER
NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Proofs, all as the
  reduced role:
  - A full 37-migration run from an empty database it owned. The result
    matched staging: 37 journal entries, 77 tables, 235 functions, every
    object owned by `daisy_migrator`, and `btree_gist` installed.
  - A no-op run against staging.
  - The authorization functions called as `daisy_web`.
  - The gated release v100 (12:43:47Z, deploy-staging run 40505512868)
    applied the 38th migration, raising the journal to 38.
- Production must be provisioned the same way: create the owner with
  `CREATE ROLE ... LOGIN` and `CREATE DATABASE ... OWNER`, or reduce an
  attached superuser with the `ALTER ROLE` above. Production also needs the
  runtime roles created first ([production](../operations/production.md#releases)).
  That is the owner's to apply.
- The cluster still has the superusers `postgres` and the original attach
  user `daisy_debate_staging`. No runbook gives `daisy_debate_staging` to an
  app, and it had no sessions on 2026-10-27. Compromising either
  remains the accepted residual risk of the shared staging cluster (ADR 0077).

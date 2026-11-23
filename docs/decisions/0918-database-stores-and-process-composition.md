# 0918: The database stores and reads; each process composes its stores

Status: accepted (owner, 2026-11-19: "execute it all" on Plan — reconcile,
steps R4.4 and R4.5; the point guard decided the shape on the owner's
delegation, Delivery 6865 and 6947). Amends [ADR 0088](0088-database-workload-admission.md)
(the lanes are opened by `openDatabaseResources`, not by `createDatabase`).

## Context

Measured on main at `17174b840`: `packages/db/src` held 65 production
modules that exported a function and touched no table, connection,
transaction or query (seat eligibility, viewer projections, group plans,
standings release, transcript freeze, lease digests copied three times,
the lane gate's pieces, error classifiers). Rules lived beside the SQL that
applied them, so the owner of a rule could not find it and a reviewer could
not tell a lock-bound check from a product decision. `index.ts` (660 lines)
built one object of 374 operations from 72 area factories; 230 files
outside the package and 7 inside imported the package root, and a process
that needed three operations was typed by, and opened lanes for, all 374.

## Decision

1. **`packages/db` holds no pure function module.** A production module of
   the package that exports a function must touch storage: read a value it
   imported from a storage primitive (Bun's client, Drizzle, the package's
   `schema/`, `tx`, `raw-rows`, `bounded-transaction` or `workload`), or take
   and use a parameter typed by a storage handle (a transaction, its opener
   or runner, a bounded transaction, a lane, any Bun or Drizzle type). A
   type-only or unused import, a lane's name or a table's row type does not
   count. `scripts/check-boundaries.ts` refuses any other module
   (`scripts/database-decisions.ts`, with fixtures); there is no exemption list.
2. **A rule goes to its owner.** A product rule the store applies under a
   lock goes to `@daisy/protocol`, beside its vocabulary (the package may
   import no other domain package), returning a refusal where it used to
   throw, since the protocol cannot depend on `@daisy/errors`; the store
   throws it. A rule only the application applies is the application's
   feature, and the store takes its outcome. A check that genuinely needs the
   locked rows (receipt binding, lease epoch, frozen revision, seal counts)
   stays in the store module that holds the lock, beside the read.
3. **One resource opener.** `@daisy/db/resources` opens a process's lane
   pools, each lane's one bounded transaction runner, the Room preparation
   runner, the dedicated LISTEN and election connections and the event sink,
   behind an opaque `DatabaseResources` whose only members are `close`,
   `laneGauges` and `drainLaneHolds`. Stores reach the handles through the
   package-private `resourcesOf`; no caller holds a raw handle.
4. **One store factory per area, on its own subpath.**
   `@daisy/db/stores/<area>` exports `create<Area>Store(resources, options)`
   and its type. Options carry only what that area needs. A cross-area need
   (the contact reactions, the restriction reactions, the content
   moderation ports) is an argument the composition passes; no store
   imports another area's store.
5. **Each process composes the stores it uses**, and its consumers name the
   narrow store types they need. The package root is deleted from the
   package's exports and banned by any spelling (`scripts/database-root.ts`).
   The web server composes in `apps/web/src/server/database.ts`
   (`openWebDatabase`, every area its routes, workers and sweeps read, with
   the policy options this process owns) and realtime in
   `apps/realtime/src/database.ts` (`openRealtimeDatabase`, six stores on its
   admission and renewal lanes). The web process's own tests, browser-suite
   workers and scripts open the web composition; each `packages/db` suite
   composes only the stores it exercises.
6. **Command records.** Tab's `action_history` and the operator receipts
   stay the two command-record kinds (Delivery 6643), with the mail queue.
   `round_commands` and `room_commands` are aggregate command logs bound to
   the Round's or Room's version with no tenant scope (Delivery 6947); each
   has one read primitive, and they share `acceptedCommandColumns`.

## Consequences

- A new pure decision file in `packages/db` fails `bun lint`.
- A process opens only the lanes its stores run on; its type names only the
  operations it reads.
- Adding an area means a store factory and a subpath; there is no central
  list to extend.

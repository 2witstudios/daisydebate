# 0917: Each web feature binds its own routes, page reads and background work

Status: accepted (owner, 2026-11-19: "execute it all" on Plan — reconcile,
step R4.6; point guard, 2026-11-23, for the owner). Builds on
[ADR 0915](0915-one-worker-primitive.md) (the worker primitive every start
function uses).

## Context

Measured on main at `4a4b9de6f`, three central files changed for every web
feature: `server/routes.ts` (281 lines; `createRoutes(app)` returned one
object of every handler, about 15 features wired inline in it, and 238 route
files reached handlers through `processRoute((routes) => routes.x.y)`),
`lib/request-session.ts` (914 lines, 65 page reads for about 25 features)
and `server/start.ts` (454 lines, 31 stoppables each named three times).
`apps/web/src/server` held 129 files, and 42 server and lib modules imported
204 times from `features/`, many of them one feature's code living in the
shared folder.

## Decision

1. **A route file binds its own feature's composition.** A feature exports
   `defineComposition('<name>', (app, process) => handlers)` from its own
   folder, and a route file reads
   `processRoute(roomComposition, (routes) => routes.submitDraft)`. The
   binder builds a composition once per process app and reuses it. The
   cache key is the declared name, not the function identity, because Next
   loads route handlers and server actions in separate bundle layers, where
   one module can be two function identities; `server/composition.test.ts`
   fails on two compositions with one name. `process` carries only what the
   process owns (the vendor fetch). A test calls the composition on its own
   app (`composer(app)(roomComposition)`), and `processRoute(...).bindTo(app)`
   selects one route's handler on a caller's app. `createRoutes`, `Routes`,
   `server/routes.ts`, the lazy billing route table and its process-installed
   loader are deleted. The loader existed so the proxy bundle would not reach
   Billing, and the process edge no longer imports any feature.
2. **Page reads live beside their feature on one request scope.**
   `lib/page-reads.ts` is the scope: the process app (`requestApp`), this
   request's session and identity (React `cache`), the clock and the
   render-read deadline. Each read is in `features/<feature>/page-reads.ts`.
   Feature page reads reach the app only through the scope (`requestApp`).
   The ISSUE-7 lint block admits the process edge by path pattern:
   route bindings (`app/**/route.ts`, `app/**/actions.ts`: `processRoute`),
   the request scope (`processApp`), and the process entries Next and the
   production start load.
3. **A feature with background work exports one start function.**
   `start<Feature>Work(process)` takes the process's shared parts (app,
   waits, work wakes, instance identity, vendor fetch) and returns its
   running loops by name (`featureWork`), or null when nothing is
   configured. `server/process-work.ts` holds the one feature list, one line
   per feature, after what the process owns itself: the work wakes, the
   availability lease that gives the instance its identity, the lane gauges
   and the retention sweep. `start.ts` names no worker. Shutdown calls every
   stop through `stopAll` before the drain begins and awaits it after the
   server and Next close and before the app closes; the drain deadline still
   exits 1. The Round AI work (judging, bot seats, analysis) is one start in
   `features/round-runtime/ai-work.ts`, because the three share one provider
   budget. The process builds and stops the one round media runtime and
   passes it on `ProcessWork` to media recovery and the bot seats. A stop
   still running at the deadline keeps the pools open until the forced exit.
4. **`server/` and `lib/` import no feature.** What stays there is the
   process edge, HTTP plumbing and what two or more features share
   (operation names, client addresses and subkey derivation moved in for
   that reason). A lint rule refuses any spelling (static, type, re-export,
   dynamic `import()`), with fixtures in
   `eslint.config-feature-boundary.test-support.ts`. Five spots compose
   features by their nature:
   - `server/process-work.ts`: the one feature list, where each feature's
     background work starts.
   - `server/app.ts`: it composes the resources every feature shares
     (database, auth, mail, analytics, policies) from validated config. Its
     per-area split is R4.5, which is held with the owner.
   - `server/process-app.ts`: the process edge chooses the outbound
     transport (dev mail capture) and the untraced probe fetch (telemetry)
     before any feature runs.
   - `server/proxy-handler.ts`: the one Next proxy decides each request
     before any route runs (access, auth redirect, each feature's browser
     policy).
   - `server/retention-targets.ts`: the one bounded retention sweep's
     targets across every feature's stores. The sweep was outside R4.6, so
     this list is still central; see Consequences.

   Tests are not covered: a server test composes feature fixtures.

5. **Code in Next's bundle and the process's own graph share identity.**
   Before, every handler was composed in the process entry's module graph.
   A composition now composes inside Next's route bundle, which carries its
   own copy of each module beside the process's. Two things relied on one
   copy. `@daisy/errors` marks a minted error with a registered symbol on
   the error itself instead of a module-level set, so a refusal minted by
   the app's rate limiter or `@daisy/db` still reads as a refusal in the
   bundle. Per-app runtimes that shutdown must stop (round media, stage
   capture) live in `App.held` instead of module-level maps.

## Consequences

- A new route is a route file and its feature's composition. A new page
  read is a function in the feature's `page-reads.ts`. New background work
  is the feature's start function and one line in the feature list.
- `server/` went from 129 files to 76. The rule reports 204 violations in
  42 files on main (`bfb17fa8d`) and none on this branch.
- Still central: the retention targets (27 features import into one list)
  and the operation-name catalogue (`server/operation-names.ts`, shared
  vocabulary for every route's logs). Both still change when a feature adds
  a target or an operation. They are recorded as not met in the R4.6 PR, as
  candidates for a later step.

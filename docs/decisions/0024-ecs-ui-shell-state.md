# ADR 0024: In-house observable store for the web UI shell (client-side ECS rejected)

Status: accepted. Originally filed as a second "ADR 0017", colliding with
[0017: Better Auth passwordless](0017-better-auth-passwordless.md); renumbered
to 0024 with no change to the decision. `bun policy` now rejects duplicate ADR
numbers.

The home dashboard shell needs client-side UI state (theme, search, active
navigation, mock content). We attempted to organize it on the Adobe ECS
runtime in the browser (`@adobe/data@0.10.19` + `@adobe/data-react@0.10.19`
in `apps/web`), extending ADR 0006's boundary. That attempt is **rejected on
evidence**: `@adobe/data/ecs` compiles archetype insert factories with
`new Function` at runtime (`dist/ecs/archetype/create-archetype.js`, "SAFE_IDENT
gates the codegen" comment block; no eval-free flag exists — the generic
insert fallback covers only malformed identifiers). Under this repository's
strict nonce CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`), any client
`Database.create` throws `EvalError` during hydration, replacing every page
with the error boundary. Verified in production build + Playwright.

Decision:

1. The Adobe boundary stays as ADR 0006 set it: `@adobe/*` is declared and
   imported in `@daisy/debate-engine` only. `scripts/check-boundaries.ts`
   (`adobeIsolationIssue`, negative-fixture tested) and the `apps/**`
   `no-restricted-imports` ESLint pattern enforce it.
2. The web shell state lives in an in-house, eval-free store
   (`apps/web/src/ui/store/`): immutable `UiState` snapshots, pure
   transaction functions grouped into plugin-style modules
   (`theme-plugin.ts`, `shell-plugin.ts`), deterministic seeding from
   `src/ui/mock/`, and a `useSyncExternalStore` hook with server snapshots —
   server HTML renders the full state (no hydration gaps).
3. The organizational model is retained: `types → plugins → components`
   layering, resources + collections in state, transactions as the only
   mutation path (data down, void actions up), binding/presentation split in
   components.
4. Constraints on the store: selectors passed to `useUiState` must return
   primitives or stable references (never fresh object literals —
   `useSyncExternalStore` would loop); the module-level snapshot is static
   mock content today. If real per-request state ever reaches this module, it
   must move behind a request-scoped provider before any server-side user
   data touches it.

Maintainability rationale: never trade a permanent security property for a
transient dependency convenience. The strict CSP protects every future
feature; a UI-state library does not justify the only-one-way relaxation. If
a future product need (e.g. a realtime debate stage with thousands of moving
entities) genuinely requires client ECS, that decision returns as its own ADR
covering the CSP change and its sign-off explicitly.

Upgrade/removal: nothing to upgrade (no vendor dependency in `apps/web`).
Removing the store means replacing `store/` and the transaction modules while
keeping component presentations and their tests green.

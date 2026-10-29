# ADR 0091: The navigation rail defaults to extended, with a cookie-persisted mini choice

Status: accepted (owner decision, 2026-10-29, confirmed in dialogue with the
owner and relayed by the point guard). Amends the "the rail never collapses"
clause of the App shell decision in `docs/development/ui-conventions.md`
(RRD-1, 2026-10-12) and extends the amendment note in
[ADR 0024](0024-ecs-ui-shell-state.md).

## Context

The one navigation rail shipped icon-only at every width (RRD-1): each
destination's name was screen-reader text plus a tooltip. That made the rail
compact but illiterate — a new member had to learn the icons before the
navigation read as navigation. The owner chose the fix in dialogue: words
beside the icons by default at desktop widths, with a request-scoped escape
to the old icon-only rail. The choice must stick across navigation and
visits, must not flash the wrong width on first paint, and the toggle must
work without JavaScript (ISSUE-18).

ADR 0024's amendment anticipated exactly this: the request-scoped UI store
"cannot be sticky by construction", so rail state never enters it.

## Decision

1. **State is a cookie, not the store and not the database.** The rail
   preference is presentation state on the browser:
   `daisy.rail=mini`; absent means extended (words are the default). The
   value is validated at the trust boundary (`parseRailPreference`); unknown
   falls back to extended. The cookie is a year, at the root, `Lax`,
   `Secure` and `HttpOnly` — the server alone reads and writes it, no
   script needs it, and it identifies no one (like the theme preference,
   [ADR 0027](0027-theme-preference.md)).
2. **The server renders the width.** `(shell)/layout.tsx` reads the cookie
   per request and passes the preference down as a prop through `AppShell`
   to `Rail`, so the first HTML carries the right column: no flash, no
   hydration mismatch. The pure preference module lives beside the shell in
   `apps/web/src/ui/layout/app-shell/rail-preference.ts`.
3. **The toggle is a server-action form.** `toggleRail` in
   `apps/web/src/app/(shell)/rail-actions.ts` flips the cookie (set `mini`,
   or delete it to return to absent-means-extended); Next re-renders the
   current route in the same response. The layout passes the action down as
   a prop — `ui/` never imports from `app/` — and the rail posts a plain
   `<form>`, so the toggle works before hydration and without JavaScript.
4. **The breakpoint is CSS.** `--spacing-nav-rail-extended` (184px) joins
   `--spacing-nav-rail` (56px, still the mini width) as a shell token, and a
   `grid-shell-extended` modifier on the shell grid applies the wide column
   only at `>=1101px` (`--breakpoint-rail`). Below that line the rail is
   icon-only whatever the cookie says: extended word spans become
   `max-rail:sr-only`, so every accessible name survives at every width,
   and the toggle hides. No script ever measures the viewport.
5. **Names are unchanged.** The visible word is decoration (`aria-hidden`)
   whenever it is shorter than the accessible name; the full name — counts
   included ("Friends, 4 online") — stays the screen-reader text. Flyouts
   (Watch, More), badges, the avatar and the logo are the same in both
   modes; the tooltip matters only in mini.

## Consequences

- `docs/development/ui-conventions.md` "App shell" describes the extended
  default and the minimize control instead of "never collapses".
- Visual baselines for the desktop shell change once, through the
  rebaseline workflow, in the slice that ships this.
- Removing the feature means deleting the preference module, the action,
  the toggle form and the CSS modifier; the rail returns to icon-only with
  no leftover surface (ADR 0023).

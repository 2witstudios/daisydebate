# 0027: Theme preference

Status: accepted. Amends [ADR 0024](0024-ecs-ui-shell-state.md): the theme
leaves the module-level UI store.

## Context

The palette and UI are not final, but the light/dark mechanics have to exist
before more surfaces are built on top of the tokens. The first version kept a
`themeColor` resource in the module-level shell store. `<html>` shipped a
hard-coded `data-theme="dark"`, and a client effect copied the store value
onto it. That design had three problems:

- A module-level store is shared across server requests, so a per-viewer
  preference cannot live there (ADR 0024, constraint 4).
- There was no saved preference and no way to follow the OS scheme.
- Any saved preference would flash on load: the server always rendered dark,
  and the client corrected it after hydration.

## Decision

1. **Three-way preference: `dark | light | system`.** When no preference is
   saved, the default is `dark`, because Daisy is dark-first. `system`
   follows `prefers-color-scheme`.
2. **Cookie, rendered by the server.** The preference is stored in the
   `daisy-theme` cookie: one year, `Path=/`, `SameSite=Lax`, and `Secure`
   over https. It is not httpOnly and it is not a secret. The root layout
   (already dynamic for the CSP nonce) reads the cookie through
   `parseThemePreference`, which is the trust boundary: unknown values fall
   back to `dark`. The layout renders `<html data-theme>`,
   `<meta name="color-scheme">` and the `theme-color` metas from the parsed
   value. The served HTML is therefore already correct, which removes the
   flash, the inline script, the nonce plumbing and the hydration mismatch.
3. **Tokens are written once with `light-dark()`.** Every color token in
   `globals.css` is `light-dark(<light>, <dark>)`, and `data-theme` only
   selects `color-scheme`: `dark`, `light`, or `light dark` for `system`.
   `system` therefore follows OS changes live with no JavaScript. The
   `globals-css.test.ts` guard fails if a color token covers only one scheme.
4. **Request-scoped provider.** `ThemeProvider` (`src/ui/theme/`) is a React
   context seeded with the request's preference, so each request is kept
   apart by construction. A switch runs through `createThemeController`,
   whose side effects are injected: write the cookie, apply the theme inside
   a view transition, then post on a `BroadcastChannel` so the viewer's
   other tabs follow. The view transition is skipped under
   `prefers-reduced-motion`. Messages from the channel are treated as
   untrusted and re-validated.
5. **The theme-color metas never change shape.** There is always one meta
   per OS scheme; an explicit choice paints both with its own color. A
   client switch rewrites their `content` in place and never removes the
   nodes, which belong to React.
6. The only control today is the Dark/Light/System radio group on
   `/settings`.

## Consequences

- `theme-plugin.ts`, `theme-effect.tsx` and the store's `themeColor` are
  deleted. The module-level store keeps only static shell state.
- New color tokens must be written as `light-dark()` pairs.
- The photo scrims stay dark in both themes on purpose, because they sit
  over dark-graded photography. The `--scrim` token deliberately gives the
  same color for both schemes.
- When accounts arrive, a server-side saved preference can seed the same
  cookie. No other part of the mechanism changes.

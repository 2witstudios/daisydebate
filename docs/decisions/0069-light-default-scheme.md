# 0069: Light is the default scheme

Status: accepted (owner decision, 2026-10-26). Supersedes the default-scheme
clause of [ADR 0027](0027-theme-preference.md) (decision 1 and the cookie
fallback in decision 2) and of [ADR 0045](0045-daisy-brand-system.md)
(section 1). Every other part of both records stands.

## Context

Daisy's palette has two schemes written once with `light-dark()`: the
board's cream (`#f5f0e4`) with forest accents, and forest (`#0d1812`). The
owner chose the cream scheme as Daisy's face: it is the brand board's own
page, and it is the scheme first-time visitors should meet.

## Decision

1. **No saved preference renders `light`.** `parseThemePreference` falls
   back to `light` for a missing or invalid `daisy-theme` cookie, so the
   root layout, `global-error` and every tab re-sync serve cream first.
   A bare `:root` without `data-theme` also resolves to `color-scheme: light`.
2. **Dark stays fully supported.** The Dark/Light/System control on
   `/settings` and the cookie mechanics of ADR 0027 are unchanged; a saved
   `dark` or `system` is honored exactly as before.
3. **Deliberate dark stages remain where they serve video.** Surfaces that
   frame live video or dark-graded photography (the room stage, the photo
   scrims of ADR 0027) stay forest in both schemes. Everything else is
   designed and verified in light first, then in dark.

## Consequences

- Light is the scheme a reviewer and a first-time visitor see by default;
  every UI change is checked in light first and dark second.
- `palette-contrast.test.ts` and the axe suites keep covering both schemes;
  neither scheme is optional.

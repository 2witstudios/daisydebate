# 0123: Stage pages render outside visitor features

Status: accepted, owner-authorized slice stage-surface (ISSUE-1372), 2026-11-09.

## Context

Egress records `/stage/[captureId]` (ADR 0107) in a headless browser. The root
layout rendered the consent banner, the analytics client, the session refresh
and draft privacy around every page, so the stage inherited them. Egress never
holds a consent cookie, so the "Your privacy choices" banner covered every
Round recording and broadcast. More stage pages are coming: each seat's POV
and other broadcast layouts.

## Decision

A page is either a visitor page or a stage page, and where it lives decides
which.

- The root layout (`app/layout.tsx`) renders the document only: `<html>`,
  fonts, theme, metadata and error capture.
- `app/visitor-features.tsx` holds what the app adds because a person is using
  a browser: draft privacy, the session refresh, analytics and the consent
  banner. Each visitor route group's layout renders it: `(shell)` and
  `(bare)`, and any new visitor group.
- Stage pages live in the `(stage)` route group, whose layout renders the
  stage and nothing a person would answer. URLs are unchanged.
- The boundary scan (`stageSurfaceIssue`) fails when the root layout or any
  `(stage)` file imports a visitor feature.

## Consequences

A new overlay added to the visitor features cannot reach a recording. A new
composition, such as a POV page, goes under `(stage)` and starts clean. A new
visitor route group must render `VisitorFeatures`, or its pages lose the
consent banner and analytics. The top-level `not-found` and `error` pages
render without visitor features. Moving between `(shell)` and `(bare)`
remounts the visitor features. The analytics client already restarts on every
navigation, and draft privacy re-reads its principal on mount, so neither keeps
state across that move.

Rejected: a nested `(site)` group around `(shell)` and `(bare)`, which would
move 133 files and collide with every in-flight shell PR for the same
guarantee; and separate Next root layouts, which need experimental
`global-not-found` while the document stays shared anyway.

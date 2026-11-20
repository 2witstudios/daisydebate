# 0114: Daisy requires JavaScript

Status: accepted (owner, 2026-11-04). Supersedes the requirement from ISSUE-18
(2026-09-23) that mutating forms work with JavaScript off, and every ADR's
no-JavaScript requirement as far as it follows from that one.

## Context

The owner: "the app isn't even functional without JS, you literally need it to
compete." A live Round needs script for video, realtime and the clock, and the
document editor needs it too. The rule still shaped menus, fallbacks and browser
tests, and agents kept raising it.

## Decision

1. Nothing new is built, specified or tested for JavaScript being off.
2. One rule remains: a form used before hydration never submits as a native GET,
   because that would put what was typed in the URL.
3. Existing fallbacks and JavaScript-off tests are removed in their own slice.
   Until then they stay green and set no precedent. Done in RECON-2.1
   (2026-11-19).

## Enforcement

`scripts/check-styling.ts` runs `scripts/javascript-required.ts`, in `bun lint`
and the quick check. It fails on a `<noscript>`, a meta refresh, or a
`javaScriptEnabled` browser context, and on a form that could submit as a
native GET: one with no `action` (a spread does not count) unless it is
`method="dialog"`, one posting to a URL with no `method`, and a GET form
outside the search primitives (`SearchForm` in web and in the operator app).
A form's method and any submitter override must be explicit literals. The
type-aware lint rule requires a callable React action if the form omits its
method. Explicit transport attributes follow JSX spreads so the props in a
spread cannot change the submission method.
A form posted before hydration still gets its 303 from `moveOn`.

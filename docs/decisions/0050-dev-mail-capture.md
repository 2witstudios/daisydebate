# 0050: local sign-in without Resend by capturing mail to a file

Status: accepted (owner request, 2026-10-03).

## Context

Signing in is a magic link sent through Resend, and Resend needs
owner-provisioned credentials. Without them a local `bun dev` server cannot
send mail, so nobody can sign in and every guarded page is unreachable.
The browser suite solves this with a wrapper process that captures outbound
mail, but that wrapper only runs the production server (AUTH-6.1), so it does
not help day-to-day development with hot reload.

## Decision

1. `DEV_MAIL_CAPTURE`, an absolute file path, switches the web process's
   outbound mail to a local capture: the real Resend sender runs unchanged,
   and only its HTTP call is answered locally and appended to that file as one
   JSON line (`to`, `subject`, `text`, `at`). Every other outbound request
   goes to the network.
2. The variable is read only at the process edge (`server/process-app.ts`),
   validated in `server/dev-mail.ts`, and **refused when `NODE_ENV` is
   `production`**: the process fails to start, naming the field and never the
   value. A relative path is refused too.
3. `bun dev:login [email]` is the convenience: it asks the running server for
   a magic link, reads the message from the file, and opens the confirm page.
   It signs nobody in by itself; the browser still redeems the link and the
   account still claims a username.
4. No route, page or session shortcut is added. Authentication is unchanged:
   no code path creates a session without a redeemed link.

## Consequences

- The capture module ships in the release artifact but is inert: without the
  variable it is never used, and production refuses the variable. The AUTH-6.1
  artifact gate (which keeps the e2e wrapper's markers out of a build) is
  unaffected, because this is a different mechanism with no listener and no
  route.
- The file holds live sign-in links for the local database only; it is under
  a git-ignored folder and each link expires and is single use.
- The e2e wrapper stays as it is: it tests the production server, which must
  never carry this flag.

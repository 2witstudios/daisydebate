# 0130: Organizations, grants and action history

Status: accepted (owner direction, 2026-11-13; built in the Daisy Tab schema
slice, TAB-4). Supersedes item 7 of [ADR 0106](0106-feature-homes.md) for the
tables named here: the grant table it deferred to its first reader now ships
ahead of that reader, declared in `policy/planned-readers.json`
([ADR 0057](0057-planned-readers.md)), because the schema is a lock of the
feature ([ADR 0128](0128-feature-parent-branch.md)).

## Decision

1. **Authority is rows, and only the evaluator reads them.** An
   organization is a league or a school. A membership says a person belongs
   and grants nothing. A role is a named set of permissions from the closed
   list in `@daisy/protocol`. A grant gives a role to a person at exactly one
   scope, an organization or a lobby, by someone, with an optional expiry.
   [The architecture](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/lrp9sdclvjac1h76c3yxiob3) is the model; this record is where it is
   stored.
2. **Users for authority, actors for competition.** Memberships, grants,
   guardian links and owners reference `users`. Entries and judges reference
   `actors`, so the tournament record survives an account's erasure.
3. **The Owner is a column, not a role.** An organization has one owner, and
   "an organization always keeps an owner" is a CHECK. Daisy, organization
   number one, is the exception: its owner is the operator, outside the
   participant database ([ADR 0043](0043-no-admin-surface-in-participant-app.md)).
4. **A grant is revoked once and never deleted or otherwise changed**, by
   trigger, so action history that names it always resolves. An
   organization-scope grant needs a membership row, by foreign key. That
   ending a membership revokes its grants, that the role belongs to the
   scope's organization or is a Daisy preset, and that a giver holds what
   they give are the command's rules.
5. **Daisy's preset roles are reference rows** (Director, Staff, Coach,
   Assistant), ranked, with rank 1 the highest. Every organization and host
   may give them. The first version has no command that creates or edits a
   role; an organization defining its own later uses the same rows.
6. **Action history is permanent and append-only.** One row per command: the
   tenant, one principal (a user or a service), the authority the evaluator
   allowed under (fixed, owner, grant, relationship, service), the grant or
   relation, the aggregate, and the accepted-command receipt. A trigger
   refuses UPDATE and DELETE for every role, and the runtime role holds
   neither privilege. "Signed" means attributed; no cryptographic chain is
   designed.
7. **Guardian links and restrictions exist closed.** The runtime role cannot
   write them, and they hold no consent field, until counsel answers on
   minors and a later migration opens them.

## Consequences

- Erasure ends a member's memberships and revokes their grants; the rows
  and the action history stay, naming the closed account by id.
- What happens to an organization, or a person-owned tournament lobby, when
  its only owner erases their account is an open owner decision. The answer
  changes the erasure step, not a table.

# 0132: Settings and templates

Status: accepted (owner direction, 2026-11-13; built in the Daisy Tab schema
slice, TAB-4).

## Decision

1. **One table holds every configurable value.** A setting is a key from the
   closed catalogue in `@daisy/protocol`, a JSON-object value, one scope
   (organization, template, lobby or event) and a hold (`default` or
   `enforced`). There is no stage scope: a value that differs between
   preliminary and elimination rounds is keyed by stage kind inside the
   value. A value that [the architecture](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/lrp9sdclvjac1h76c3yxiob3) makes a setting is never
   also a column.
2. **The database proves the scope and the key; the value is opaque to
   it.** One CHECK admits exactly four patterns of scope columns, each
   carrying that scope's own isolation key, and composite foreign keys prove
   the key. One row per scope and key. The key is CHECKed against the
   catalogue, so a new key is a migration, which is where it is reviewed.
   `enforced` is refused at event scope.
3. **Held by the writer, not the database:** a value fits its key's schema;
   a key is set only at a scope its catalogue entry allows; two different
   enforced values never enter one chain; nothing is set below an enforced
   row; resolution order. The catalogue's parse is the only way a row is
   written or read.
4. **A setting row has no version.** Clearing a setting deletes its row, so
   the optimistic counter is `settings_version` on the scope's own row,
   apart from that row's own version.
5. **A template pins a format and a ballot definition, and the pins never
   change**, by trigger: a different format or ballot is a new template.
   This template is a row an organization owns, not the league template
   of [ADR 0078](0078-standard-formats-league-templates.md), which is a
   catalog format whose `catalog_role` is `template`.
   Copying a template writes its values into the event's own settings and
   keeps no link. Following it joins the chain: an event that follows a
   template has its format by foreign key, and a Room follows only a
   template its lobby offers. Only a standing lobby offers templates.
6. **A Room stores no settings.** Publishing a draw resolves the event's
   settings, records the resolved values on the draw, and pins what the Room
   needs on the Room's existing columns.
7. **Settings, templates and ballot definitions are readable across
   tenants** ([ADR 0129](0129-tenant-isolation-by-row-level-security.md)).

## Consequences

- One table for everything means a bad writer can damage every kind of
  configuration at once, and nothing in the database ties a value to its
  key.
- Divisions have no table and no foreign key: a division is a name in the
  event's `entry.divisions` setting, so removing one that entries or stages
  name is refused by the command.
- Rules that were CHECKs in earlier designs (release order, recording by
  audience) are the catalogue schema's or the evaluator's, per person.

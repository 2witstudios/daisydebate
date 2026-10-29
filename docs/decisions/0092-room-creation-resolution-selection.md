# 0092: Explicit resolution selection at Room creation

Status: accepted; owner-approved create-room design, 2026-10-29 (FMT-8).

## Decision

Room creation presents Freestyle, Policy, Value and Custom. League templates
are Custom starting points. Every format-rule edit preserves the draft,
selects Custom and clears Ranked; room name and visibility are independent.

Resolution selection is Policy res, Value res, Strike or Custom. Published
Policy and Value resolutions are immutable records with a kind, text,
provenance and publication time. A replacement retires the current record;
existing Rooms keep their pinned text and publication reference. Creation
rechecks that the selected record is current under the writing transaction.
The client never supplies trusted published wording. Initial publications
reuse Daisy-original resolution bank revision 1, with explicit provenance.

Standards select their canonical resolution method. A different method or
custom wording makes the Room Custom. Ranked creation requires a canonical
format/preset and its canonical resolution method. Custom submissions may
retain a validated catalog basis, never derive ranked eligibility from it.

Strike is one option with product-owned rules. It exposes no draw-size,
source, first-striker or timer customization in the create-room form.

POI is an unranked Custom questioning style with simple unmuting. No
raised-hand request/accept workflow is required; that is ISSUE-871.
The implementation must grant actual speaking/media permission, not
merely rename the existing free cross-examination setting.

Creation uses the existing authenticated command, atomic writer, active-room
invariant and shared Round lifecycle. The form works without JavaScript;
client draft editing and preview enhance the same validated native POST.

## Consequences

Published resolutions have one Formats-owned home, independent from strike
bank sampling, rating seasons and league templates. Their publication
calendar is not a second format dimension. A Room's existing topic text
remains its resolved proposition; this decision adds explicit selection and
provenance rather than a second competing resolution value.

The create-room editor posts to its own same-origin, authenticated route,
with a streaming 128 KiB bound (64 speech rows plus their native form fields).
The global 16 KiB server-action cap stays unchanged. Enhanced submissions
return form state; native previews/refusals use POST/303/GET with one latest
answer per member in Redis, expiring after five minutes. Answers are scoped
to the member, command and optional rematch source, never logged or used as
competitive authority. The member’s own draft joins their data export and
is deleted before account closure; any in-flight answer still expires within
five minutes. Actual creation still validates against the durable
catalog and publication under the existing Room writer transaction.

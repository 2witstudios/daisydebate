# Round media persistence

The media adapter stores one opaque LiveKit room name per Round and one opaque
identity per authoritative Round participant. It does not copy actor, role or
slot authority. Composite foreign keys bind a media participant to both the
session's Round and its competitive seat. `createMediaSessionStore` in
`@daisy/db/media-session` serializes binding creation on the Round row; terminal
Rounds and ended sessions refuse admission. Its caller must resolve fresh
application authorization and the judging window before requesting a binding.
This storage operation alone neither creates a vendor room nor mints credentials.

## Privacy classification

Every column introduced by VIDEO-1.3 is listed below. Identifiers are not bearer
credentials. These rows exist only for live media routing; no audio, display name
or vendor token is stored. Media failures never determine a competitive result.

| Table              | Columns                                                  | Category   | Purpose                                                |
| ------------------ | -------------------------------------------------------- | ---------- | ------------------------------------------------------ |
| media_sessions     | id, round_id, room_name                                  | identifier | Bind a Round to an opaque media room                   |
| media_sessions     | created_at, ended_at                                     | none       | Bound session lifecycle                                |
| media_participants | id, session_id, round_id, round_participant_id, identity | identifier | Resolve opaque media identities to authoritative seats |

The participant bindings follow Round erasure and are deleted with their session.
Round participant deletion is restricted until media bindings are removed, so
subject erasure must remove dependent media routing records first. Production
privacy policy activation remains human-held. Transcript text remains personal,
private to seated debaters/judges and retained for 180 days under DEC-101;
retention deletion is tracked by ISSUE-322. This change stores no transcript text.

## Historical speaking authority

`round_speaking_intervals` records accepted eligibility as half-open
`[started_at, ended_at)` intervals for a durable segment and Round seat. A null
end remains open. Simultaneous cross-examination seats are allowed; overlapping
intervals for the same segment and seat are rejected by a PostgreSQL GiST
exclusion constraint. This uses PostgreSQL 18's bundled trusted `btree_gist`
extension for text equality. The SQL constraint is handwritten alongside the
generated migration because Drizzle 1.0.0-rc.4 has no exclusion schema builder.

The command executor must close/open intervals in the same transaction as its
accepted checkpoint/version and segment writes, using the authoritative accepted
instant. Positive start versions and paired end/version fields prevent partly
closed rows. Optional start/end command IDs carry scoped Round foreign keys;
automatic clock transitions use versions without inventing client commands.
The history is competitive authority, not proof that any audio was observed.
Calibrated capture coverage and uncertainty are separate producer obligations.

| Table                    | Columns                                                                              | Category   | Purpose                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------- |
| round_speaking_intervals | id, round_id, segment_id, round_participant_id, started_command_id, ended_command_id | identifier | Bind accepted speaking authority to its segment, seat and optional command |
| round_speaking_intervals | started_at, ended_at, started_version, ended_version                                 | none       | Reconstruct accepted eligibility boundaries and versions                   |

These rows follow Round erasure. Seat deletion is restricted until dependent
intervals are removed; segment deletion cascades its intervals. They contain
neither transcript text nor raw audio. Runtime accepted-command atomicity,
coverage, freeze and judging integration require their own real-service proof.

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

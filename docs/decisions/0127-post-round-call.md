# 0127: The post-round call

Status: proposed (owner request and decisions, 2026-11-12; [plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/xwidrrh6cj7r68w2lm0z3alo)).
Amends [ADR 0053](0053-live-video-self-hosted-livekit.md) §3,
[ADR 0067](0067-playable-round-policy-and-acceptance.md) (terminal cleanup),
[ADR 0099](0099-spectator-release-authority.md) (the privacy boundary) and the
judge-anonymity decisions DEC-98 and DEC-174. Builds on
[ADR 0110](0110-disposable-vendor-room.md) (a vendor room is disposable; the
media session is not) and [ADR 0106](0106-feature-homes.md) (each bound is its
own policy).

## Context

After a Round, people want to stay and talk: a judge explains the decision, the
debaters ask about it. Today the call ends the moment the Round completes: the
server stops granting media and deletes the room, and every browser moves to
the result. For a Round with no judge that is about two minutes after the last
speech. People then move to a separate call elsewhere.

The owner asked for an option that keeps the call open after the Round, for
unranked play only, never recorded and never streamed, with no separate thing
to join.

## Decision

1. **A casual host may choose a post-round call.** One checkbox on the create
   page, "Post-round feedback", beside Ranked and Record match
   (`rooms.post_round_call`). Ranked switches it off, and the create contract
   and the store both refuse it for a ranked Room. It is not a capture choice
   and is not a field of `capture`. In code the concept is the _post-round
   call_: "feedback" already names a judge's ballot feedback.
2. **The choice freezes at Start round** (`rounds.post_round_call`). A call is
   a conversation, so a Round with fewer than two human seats freezes it off.
   Every seat is told before Ready that the call stays open, that judges can
   be seen and heard, and that it is not recorded.
3. **It is a phase of the Round's one media session, not a Round stage.** A
   Round's terminal status stays final. One pure rule (`mediaPhase`) names
   where media stands: `round`, `post-round-call-opening`, `post-round-call` or
   `closed`. Only a `completed` Round has a call; forfeits complete, so they
   do. An abandoned Round has none: nobody was there, or media is what failed.
4. **The call gets its own vendor room, after the Round's is proven gone.**
   When the Round completes, reconciliation deletes the Round's room and proves
   it absent. Only with that proof does the session take a fresh opaque room
   name (`media_sessions.post_round_call_opened_at`). Until then admission
   answers "try again" and no token names the new room.
5. **Nothing but a human seat can join it.** The capture agent's token is
   refused once the Round is over. The stage route names no room, so mints no
   observer token, once the Round is over. A bot is never admitted. So the call
   is never transcribed, recorded or broadcast, by construction and not by a
   hold: no observer or agent was ever in the call's room.
6. **Everyone human on the call may be seen and heard**, the judge included.
   A judge joins the call's room visible; no hidden participant is revealed in
   place. Debaters see the judge by seat ("Judge"), never by name: the Round
   view still redacts the judge's identity. This amends DEC-98 and DEC-174 for
   Rounds whose host chose the call, where every seat was told before Ready.
7. **It ends at 30 minutes from the Round's end, or once everyone has left.**
   The cap runs from `rounds.completed_at` (`postRoundCallPolicy.maxMs`). Each
   reconcile pass records since when the room has stood empty
   (`media_sessions.room_vacant_since`); empty for 60 seconds ends the call
   (`vacantGraceMs`, above the vendor's 20-second departure timeout, so a
   reload does not). An absent room during the call is vacancy, never a lost
   room: no capture agent holds it open. The session then ends as any other.
8. **Nobody joins anything.** A debater's room and a judge's room stay on
   screen: the clock reads "Call ends", the result is one link away, and anyone
   may mute. The browser follows the session to the call's room as it follows
   a rotation.

## Consequences

- `mediaWindowClosed(status, now, finalSegmentEndedAt)` becomes
  `mediaPhase(facts)`. Every reader of the window (grants, admission, the
  reconcile pass, recovery scheduling, the projection) reads one set of facts.
- A judge who stays in the room after the Round is visible on the call with
  camera and microphone open, as the owner decided. The browser's own
  permission prompt is the last gate on a judge's device.
- A member on a post-round call is no longer held by the Room (ADR 0070
  released them at the last speech), so they can open another Room meanwhile.
- Each open call costs a reconcile pass every heartbeat for up to 30 minutes.
- Recorded and broadcast casual Rounds may also have a call: the Round's
  capture ends with the Round, and the call's room is one nothing observes.
- No stored data is added for the call: it is live audio and video, unstored.

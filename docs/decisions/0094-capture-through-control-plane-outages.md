# 0094: Capture through control-plane outages

Status: accepted (agent decision on the owner's behalf, confirmed by the point
guard on the Delivery channel, 2026-11-02, ISSUE-885).

## Context

Capture depends on the web app for its lease, history and writes, and on a
single web machine that a deploy replaces. Any failed renewal ended the session,
and an expired lease could only be replaced at a new epoch, which always seals
partial. One web deploy during speech therefore cost that speech its complete
seal, and with it the AI ballot under the incomplete-evidence rule. Round
gb29cv50qy6pi4p6mjt5ujoo shows a 17.755 s gap across epochs during such a deploy.

## Decision

1. A control plane that does not answer is not a refusal. The worker keeps
   hearing and retries, within one total memory bound per worker and for at
   most 120 s; past that the read, renewal or write ends the session, which logs
   and relaunches.
2. A renewal after expiry reinstates the same epoch only if the lease row still
   names that worker and epoch, under the row lock. No write is admitted while
   the lease is expired. Any takeover or rotation has moved the row and fences
   the old worker for good.
3. A stream seals complete only if the sealing process lost no frames it held.
   Contiguity comes from frames actually held, never from the lease.
4. A planned worker replacement costs start-up time, not start-up plus expiry: a
   stopping session releases its lease. A bounded rail hold on worker deploys
   during active capture, counting only fresh leases and never blocking forever,
   ships separately behind human sign-off (CCAP-10).
5. A partial stream reports its gaps from durable evidence on each read.
6. The live transcript reads its HTTP route, not a server action. The reply
   declares a contract version and the browser parses only the fields it renders,
   so a field added anywhere, the Round view included, does not disturb an open
   tab. A raised version or a removed field asks the reader to reload rather than
   reading as an outage, with the text kept on screen.
7. A reinstated lease logs `media.capture.lease_reinstated` with how long it was
   expired. A session that reaches the budget exits with its stage, already
   logged as `media.capture.failed`.

Rejected: a longer lease, which lengthens the gap after every crash; a new epoch
in the same process, which seals partial by rule although the same process heard
the audio; and a gapless overlap handover, which needs a standby listener, a
successor lease, a schema change and a rail change, for a benefit the hold mostly
gives. Reconsider the handover if the hold's deploy delay hurts.

## Consequences

Unexpected crashes and host events remain honest gaps. Pending audio stays in
memory and is dropped on commit or end, so nothing about retention changes. An
outage that spans a speech boundary still loses that speech's opening, and a
track first heard more than 30 s after the last answered read is refused until a
read answers. Late audio past `CAPTURE_STT_LAG_MS` on a closed session is lost.

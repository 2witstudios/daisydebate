# 0160: DMs like Discord, with consent before an adult's contact with a minor

Status: accepted (owner, 2026-11-19, decision 90 on
[page 10](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/jro30yyuynd11e7qzjfdby0u);
slice yls-dm-consent,
[Plan — yls-dm-consent](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ez3tnk8yku9mpdscf56cisar),
YLS-13 to YLS-17). Amends [ADR 0061](0061-messaging-social-policy.md) and
DEC-251's DM pairs, and [ADR 0072](0072-friendships-and-presence.md) §5.

## Context

DEC-251's beta DM policy allowed a DM only within one age band, adult with
adult and 16-17 with 16-17, and ADR 0061 forbade friendship from bypassing the
band rule. Members aged 13 to 15 (decision 88) had no DMs at all, and a coach
could never message a student. The owner: "Daisy IS a social platform, we
can't lobotomize that". Engagement must be possible for every member 13 and
over, while minors stay protected from unsolicited contact by adults.

## Decision

1. **One rule.** `dmAllowed` in `packages/auth/src/social-policy.ts` is a pure,
   total function of both age bands, whether the pair are friends, whether the
   asker is the minor's linked staff, and the recipient's request setting. The
   same rule answers a new request, accepting it, posting and typing, on the
   web and in every process that reads the DM policy. Under 13 on either side
   is always refused.
2. **Any member 13 or over may DM any other through a message request**: the
   existing request, introduction and accept flow, with DEC-251's limits. Two
   minors of any mix of 13-15 and 16-17, and two adults, need no relation.
3. **An adult's first contact with a minor is a friend request.** An adult may
   ask a minor, or keep posting to one, only while they are friends or the
   adult is one of the minor's linked adults (`daisy_linked_adult_users`,
   [ADR 0158](0158-linked-adults-in-one-registered-function.md): the owner or
   roster-managing staff of the minor's open school, or an active guardian).
   Friend requests carry no free text, so no message reaches a minor before
   they accept. A minor may ask an adult; that DM keeps posting without a
   friendship, and block is its way out.
4. **Ending the basis ends the posting.** An adult-initiated DM with a minor
   stops accepting posts when neither an accepted friendship nor a staff link
   remains. Blocking stops any DM. History stays readable as before.
5. **Ways out are never gated by age.** Reading, declining, cancelling and
   blocking ask only that the member is current; only accepting asks the rule.
6. **Who can send me message requests.** Each member chooses Everyone (the
   default), Friends only or No one (`messaging_request_settings`; no row is
   everyone). It gates new requests only, never a conversation already
   accepted, and binds the minor's linked staff as it binds anyone. A new
   request tells the recipient through a `dm_request` notification; the
   introduction stays in Messages. Opening an existing pending or accepted
   DM uses its read permission, provided neither member has blocked the other.
   Setting writes take the same account lock as request admission.
7. **Refusals stay masked.** A refused request answers as an unknown member
   (NOT_FOUND), as before. A profile offers Add friend in place of Message
   wherever only a friendship would open a request: an adult toward a minor
   and a recipient taking requests from friends only look the same, so no age
   shows.
8. **Policy revision 2.** `betaDmPolicy` mints revision 2 and honours revision 1
   (`earlierRevisions`). Every revision-1 channel joined two adults or two
   16-17s, which the rule also allows, so no existing DM changes.
9. **Facts under the same fence.** `loadAccountPolicyFacts` reads each
   account's request setting, its friendships within the cast and, for a
   minor, its linked adults in one statement on the fenced transaction, beside
   the age fact. A missing fact is closed: no friendship, no staff link, a
   setting of no one.
10. **Groups stay off** (DEC-127). Their admission holds each pair to the rule
    in both directions with no relation, so a group never mixes an adult and a
    minor.

## Consequences

- ADR 0061's "friendship bypasses age rule" negative control and its
  same-band-only row are replaced by this rule; its masking, request, block
  and limit rules stand.
- ADR 0072 §5: friendship now opens an adult's DM with a minor, through the
  DM rule; it still grants no Room membership or competitive standing.
- Compliance (Children) and the privacy policy notes describe the rule. State
  laws on 13-15 consent stay a counsel question (YLS-9).
- A guardian link holds no rows yet (counsel); when it does, a guardian is a
  linked adult and so may ask directly.
- Decision 92 reserves guardian approval and parent-managed request settings
  for PC-2. The friendship requirement counts accepted friendships. DM requests can
  be reopened after decline or cancellation. The request-setting write and
  admission both use the recipient's account fence, where PC-2 can enforce
  who may change the setting and which setting applies.

# 0163: Guardian links are confirmed or created with consent evidence

Status: accepted in decisions 91–93 and Delivery #5279 (2026-11-19)

## Context

A parent or legal guardian needs a relationship to a child’s Daisy account.
The child must be able to confirm a request themselves and report a false
claim. A parent can also invite a child aged 13–17 into the ordinary sign-in
and onboarding flow. The old family controls treated coaches as guardians and
used guardian restrictions to fence tournament visibility.

## Decision

- A guardian link joins two accounts. A requested link grants no authority.
  A child can confirm it or report that the requester is not their parent.
  A refusal records a safety report about the requester and shows the requester
  only that the link was not confirmed. A parent may cancel a request or end
  an active link.
- The parent signs the parental consent notice. A child confirming a link
  signs the confirmation notice. Each signature records the signer, time,
  method, notice version and SHA3-256 digest of the exact words. PostgreSQL
  refuses evidence updates and deletes. Ending a link preserves these records.
- A parent provides a first name, birth month and the child’s own email.
  Daisy answers “We emailed [address]” for an eligible submission. A new
  address receives Better Auth’s ordinary sign-in link. The verified child
  sees the supplied month, accepts Terms, and claims the invitation in the
  same transaction that writes the month and active link. If the parent is
  admitted to the beta, the new child inherits approval. An existing child
  account receives a private confirmation request and keeps its existing age
  and beta state.
- Guardian data is fenced by person scope. The web role can insert and
  update links and invitations and append consent evidence. The age-step
  claim uses the subject’s verified address. Expired requests cannot claim
  an account. Claim, cancellation and linked-account erasure clear the invitation’s contact details. The hourly retention sweep clears expired invitations and closes any unanswered links they created.
- Settings exposes Parental controls and Your parents behind the
  `parental-controls` release flag. Staging uses its release default.
  Production activation and any counsel-directed changes require owner sign-off.
- Under a linked child's More controls, the guardian can sign the media release
  (ADR 0151), or explicitly withdraw parental consent and close the child's
  account. Both operations recheck the active link and current ages under
  the ordered account locks. Closure runs the same subject-rights transaction
  as self-closure (ADR 0087), ends active links and releases, revokes sign-in
  and preserves required evidence and the competitive record. The same durable
  vendor queue handles Stripe cleanup after local closure (DEC-365).
- Coaches run teams. They gain no guardian relationship from an organization
  role. Drop `restrictions` and its video and lobby fields. Leave
  `restriction_lobbies` attached to a guardian link for PC-3. Tournament
  entry remains adult-only until TF-2.

This supersedes the guardian commands and closed family read surface in
[ADR 0130](0130-organizations-grants-and-action-history.md) and the guardian restrictions in
[ADR 0136](0136-person-scoped-family-action-history.md). The league and lobby model is defined by [ADR 0162](0162-daisy-is-a-league-open-and-youth-are-lobbies.md).

[ADR 0165](0165-guardian-protection-levels.md) applies protection levels to
active guardian links.

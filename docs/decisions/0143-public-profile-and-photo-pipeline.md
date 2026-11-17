# 0143: The public profile and the profile photo pipeline

Status: accepted (owner, 2026-11-16; [plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/l6ida68g5fopfzw6ag4nqje0)).
Builds on [ADR 0036](0036-privacy-by-design.md), [ADR 0075](0075-beta-access-gate.md),
[ADR 0087](0087-compliance-from-obligations.md), [ADR 0102](0102-refusals-are-typed-reasons.md),
[ADR 0103](0103-whos-online.md) and [ADR 0114](0114-daisy-requires-javascript.md).

## Context

Members could not change how they appear: every surface showed `@username`
and initials. A public beta needs a display name, a bio and a photo, and a
photo is user content anyone can see, so it needs storage, a malware scan,
an inappropriate-content check, reporting and operator removal. The owner
chose a display name, a bio (no region) and photo upload with the full
pipeline, and no username change for now.

## Decision

1. **The public profile is its own concept.** It is what a member chooses to
   show besides the username and the competitive record: a display name
   (at most 40 characters), a bio (at most 160) and a photo. It lives in
   `member_profiles` and `profile_photos`, never in auth's `users`.
   `users.image` stays only because Better Auth's adapter reads it, and a
   CHECK keeps it null.
2. **The username stays the competitive identity.** A display name shows on
   the profile header, the account menu and People and Friends rows. Ballots,
   standings, Rooms, chat and every judge surface keep `@username`, so hidden
   judges stay hidden and nothing competitive is renamed. Display names are
   normalized at the boundary (NFC, invisible and bidirectional controls
   removed, whitespace collapsed), so one cannot render as another, and may
   not hold `@` or `＠`, so none reads as a username. A refused edit answers a
   closed word (`display-name-too-long`, `display-name-handle`, `bio-too-long`).
   The profile row and its id last for the account's life; a cleared field is
   null, so a report of the text still finds it after a clear.
3. **A photo is stored only once it is checked.** The member posts the image
   as the request body (JavaScript is required, ADR 0114). The budget, the
   deployment's storage and the member's right to add a photo are settled
   before the body is read. The intake bounds
   it at 5 MB and JPEG, PNG or WebP; clamd scans it; sharp decodes it under a
   pixel bound, turns it upright, drops all metadata and encodes 512 px and
   128 px square WebP renditions; then the automated check reads the 512 px
   rendition. Only `allow` publishes. `review`, a failed check or no
   configured check leaves the photo `in_review`, visible to its owner only,
   until an operator approves or rejects it. `block` is refused and nothing is
   stored. No scanner or no bucket refuses every upload as unavailable.
4. **One lifecycle, one deletion path.** A photo is `in_review` or
   `published` while live, and ends `rejected`, `removed`, `withdrawn` or
   `erased`; `profilePhotoTransition` in `@daisy/protocol/public-profile` is
   the whole table. A member has at most one photo per live status, so a
   published photo stays while its replacement is in review. A terminal row
   is the obligation to delete its image: the `profile_photo_deletions`
   worker deletes the renditions, then the row, retrying with backoff, so an
   ended photo's image never outlives a storage outage unrecorded. An upload
   writes its row first, as `uploading` and owing its deletion an hour later,
   then stores its objects, then is recorded live; an upload that fails at any
   step is deleted by the same sweep, so no stored object is ever without a
   row, and no failure path deletes an image a live row may show. Member
   writes and operator commands lock a member's photos in the same order, so
   they never deadlock.
5. **Photos are served through the application.** The bucket is private.
   `GET /api/profile-photos/:photoId/:size` streams a published photo with
   `max-age=60` and an ETag, inside the moderation delivery bound, and an
   in-review photo only to its owner, uncached. There is no public bucket URL
   and no signed URL, so a removal or erasure takes effect within a minute.
   Each client has an image budget, spent before any read; a client the
   ingress cannot name shares one bucket. The budget fails open, logged, on a
   limiter outage, and there is no global bucket.
6. **Reports and removals use the one moderation queue.** A photo, a display
   name and a bio are content report targets with the safety reasons
   (impersonation included); anyone may report someone else's. A text report
   names the profile, whose id lasts across edits, so a repeat report by the
   same reporter reopens their resolved one with its new reason, once that
   field changed after the resolution (both by the database clock, at the
   statement, in milliseconds). Operators, in
   the admin app over the signed operator API (ADR 0079), approve or reject a
   photo in review and remove a published photo or one text field, each with
   its closed reason in the admin audit chain. Repeat abuse uses the existing
   restrictions.
7. **Withdrawal survives restriction.** `profile.public.read` and
   `profile.public.withdraw` (clearing the text or the photo) are withdrawals
   under ADR 0075; adding or changing content needs participant access.
8. **Subject rights.** Export returns the text and each photo's record.
   Erasure deletes the text and ends every photo as `erased` in the erasure
   transaction; the deletion worker removes the images afterwards. The
   username and record stay (ADR 0087).

## Consequences

- The automated check's vendor, its DPA and the production bucket and
  scanner are a human sign-off (PROF-12). Until a check is configured, every
  photo waits for an operator: slower, never unchecked.
- The image scanner and decoder are one feature, `features/image-intake`,
  shared by messaging files and profile photos.
- A changed display name shows everywhere it is read at once; nothing
  caches it.

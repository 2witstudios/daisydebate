-- ADR 0157: the youth sweep no longer withholds a Youth Round's Broadcast
-- video; `media_withheld` is an operator's alone. Clear the marks the sweep
-- left. Its stop always carries 'youth_round_private' (an earlier operator or
-- moderation reason is kept by coalesce, and its own withholding then came
-- from stopBroadcast, which this leaves alone).
UPDATE "broadcasts" SET "media_withheld" = false
WHERE "stop_reason" = 'youth_round_private' AND "media_withheld";

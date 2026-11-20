ALTER TABLE "media_releases" DROP CONSTRAINT "media_releases_withdrawn_check", ADD CONSTRAINT "media_releases_withdrawn_check" CHECK (("withdrawn_at" is null) = ("withdrawn_by" is null)
        and ("withdrawn_by" is null or "withdrawn_by" in ('parent', 'club', 'erasure', 'superseded'))
        and ("withdrawal_note" is null or ("withdrawn_at" is not null and char_length("withdrawal_note") <= 1000))
        and ("withdrawn_at" is null or "withdrawn_at" >= "signed_at"));
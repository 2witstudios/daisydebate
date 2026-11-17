type ProfileText = {
  readonly displayName: string | null;
  readonly bio: string | null;
};

/**
 * An edit that only clears or keeps each field shrinks what the member shows:
 * a withdrawal, which a restricted member keeps (ADR 0075, ADR 0143). Setting
 * or changing any text needs participant access.
 */
export const isTextWithdrawal = (current: ProfileText, edit: ProfileText) =>
  (edit.displayName === null || edit.displayName === current.displayName) &&
  (edit.bio === null || edit.bio === current.bio);

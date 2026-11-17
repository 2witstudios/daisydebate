/** Someone as a list shows them: their username, and a display name if they chose one. */
type Named = {
  readonly username: string;
  readonly displayName: string | null;
};

/**
 * What a screen reader hears for a person on a list (ADR 0143): the display
 * name, with the username always beside it, since only the username is an
 * identity and a display name may look like anyone's.
 */
export const publicNameLabel = ({ username, displayName }: Named): string =>
  displayName === null ? `@${username}` : `${displayName} (@${username})`;

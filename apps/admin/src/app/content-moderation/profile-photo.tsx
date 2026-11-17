/**
 * A member's profile photo as an operator sees it: the 512px rendition the
 * participant app read back, or a plain sentence when there is none to show.
 */
export function ProfilePhoto({
  src,
  username,
  live,
}: {
  readonly src: string | null;
  readonly username: string;
  readonly live: boolean;
}) {
  if (src)
    return (
      // A data URL from the operator API: nothing for next/image to optimize.
      <img
        src={src}
        alt={`Profile photo of ${username}`}
        width={256}
        height={256}
      />
    );
  return (
    <p className="muted">
      {live ? 'The image could not be read.' : 'Its image is deleted.'}
    </p>
  );
}

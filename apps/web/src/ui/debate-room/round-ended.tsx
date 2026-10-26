import { MediaPageLink } from '../round-media/media-page-link';

/** True once a Round can no longer be debated or judged live. */
export const roundEnded = (status: string): boolean =>
  status === 'completed' || status === 'abandoned';

/**
 * What a live room shows once its Round has ended, while it moves to the
 * result page; the link is the same move without JavaScript.
 */
export function RoundEndedNotice({ roundId }: { readonly roundId: string }) {
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-3 p-6">
      <p role="status" className="text-lg font-strong text-ink">
        This round is over.
      </p>
      <MediaPageLink href={`/rounds/${roundId}`}>See the result</MediaPageLink>
    </main>
  );
}

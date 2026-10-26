'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { MediaPageLink } from '../round-media/media-page-link';

/** True once a Round can no longer be debated or judged live. */
export const roundEnded = (status: string): boolean =>
  status === 'completed' || status === 'abandoned';

/**
 * A live room whose Round has ended takes its reader to the Round's result
 * page; the link is the same move without JavaScript.
 */
export function RoundEnded({ roundId }: { readonly roundId: string }) {
  const router = useRouter();
  const href = `/rounds/${roundId}`;
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-3 p-6">
      <p role="status" className="text-lg font-strong text-ink">
        This round is over.
      </p>
      <MediaPageLink href={href}>See the result</MediaPageLink>
    </main>
  );
}

import Link from 'next/link';
import { Panel } from '../../components/panel/panel';
import { CopyableUrlField } from '../../watch/copy-link/copyable-url-field';

const steps = [
  'In OBS, under Sources, choose + and then Media (Media Source in older versions), and name it.',
  'Untick Local File.',
  'Paste the feed URL into Input, leave the other settings as they are, and choose OK.',
  'Right-click the source and choose Transform, then Fit to screen. Put your own camera or overlays above it in the list.',
] as const;

/**
 * Offers the Round's official feed to streamers. The viewer places it only while
 * the audience has a stream (`streamableFeedOf`). The steps are the settings
 * proven on OBS 32.1.2.
 */
export function StreamThisRound({
  feedUrl,
  mode,
}: {
  readonly feedUrl: string;
  readonly mode: 'ranked' | 'casual';
}) {
  return (
    <section aria-label="Stream this Round">
      <Panel title="Stream this Round">
        <div className="flex flex-col gap-4 text-base">
          <p>
            Add Daisy&apos;s official feed to your own stream. It needs no
            stream key. The picture and sound are the Round&apos;s, with
            Daisy&apos;s branding and link already in the video.
          </p>
          <CopyableUrlField url={feedUrl} label="Official feed URL" />
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-sm text-ink-muted">
            Any tool that can play an HLS address can use the same URL. If the
            Round has not reached the feed yet, OBS shows nothing and keeps
            trying. If the picture starts to jump after a break in the feed,
            delete the source and add it again. When the Round ends, stop the
            source or switch scenes: OBS replays the last few seconds for about
            two minutes after the feed ends, then shows nothing.
          </p>
          {mode === 'ranked' ? (
            <p className="text-sm text-ink-muted">
              A ranked Round is delayed for integrity, and the feed carries the
              same delay. You may stream it, with your own camera and
              commentary, under the{' '}
              <Link href="/content-policy" className="underline">
                ranked content policy
              </Link>
              .
            </p>
          ) : null}
        </div>
      </Panel>
    </section>
  );
}

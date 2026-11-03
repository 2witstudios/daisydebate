import Link from 'next/link';
import type { RecordingHistoryScreen } from '../../../features/recording/history';
import { watchRoutes } from '../../../features/watch/routes';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { CopyLink } from '../../watch/copy-link/copy-link';
import { StateCard } from '../../watch/state-card/state-card';

type History = Extract<RecordingHistoryScreen, { kind: 'history' }>;

export type RecordingHistoryProps = {
  readonly screen: History;
  /** A fixed notice key from the removal form, already validated. */
  readonly notice: keyof typeof removalNotices | null;
};

export const removalNotices = {
  requested: 'The recording is being removed for everyone.',
  confirm: 'Tick the box to confirm the removal.',
  changed: 'This recording changed. Check it and try again.',
  refused: 'This recording cannot be removed.',
} as const;

const card =
  'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1';
const label = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

const VISIBILITY: Readonly<Record<History['visibility'], string>> = {
  public: 'Anyone can replay it.',
  unlisted: 'Anyone with the link can replay it.',
  private: 'Only the debaters and judges can replay it.',
};

const mediaStates = {
  processing: ['clock', 'The video is being prepared'],
  failed: ['alert', 'The video could not be saved'],
  not_recorded: ['play', 'This debate was not recorded'],
  removed: ['alert', 'This video is no longer available'],
} as const;

function Media({ media }: { media: History['media'] }) {
  if (media.state === 'watch')
    return (
      <video
        controls
        preload="metadata"
        src={media.playlistHref ?? undefined}
        aria-label="Recording of this debate"
        className="aspect-video w-full rounded-xl bg-surface-stage shadow-2"
      />
    );
  const [icon, title] = mediaStates[media.state];
  return <StateCard icon={icon} title={title} />;
}

function Transcript({
  transcript,
}: {
  transcript: NonNullable<History['transcript']>;
}) {
  return (
    <section aria-label="Transcript" className="flex flex-col gap-3">
      <h2 className="text-md font-strong text-ink">Transcript</h2>
      {transcript.coverageNote ? (
        <p className="text-sm text-ink-muted">{transcript.coverageNote}</p>
      ) : null}
      <form method="get" role="search" aria-label="Search the transcript">
        <input
          type="search"
          name="q"
          defaultValue={transcript.q}
          maxLength={80}
          aria-label="Search the transcript"
          placeholder="Search the transcript"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-ink placeholder:text-ink-faint"
        />
      </form>
      {transcript.rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No turns to show.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {transcript.rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 py-3">
              <span className="text-sm text-ink-muted">
                {`Turn ${row.turn} · ${row.speaker}${row.partial ? ' · partial' : ''}`}
              </span>
              <p className="text-base text-ink">{row.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Result({ result }: { result: NonNullable<History['result']> }) {
  return (
    <section aria-label="Result" className={card}>
      <span className={label}>Result</span>
      <span className="font-display text-xl font-bold text-ink">
        {result.headline}
      </span>
      {result.ballots.map((ballot) => (
        <div key={ballot.title} className="flex flex-col gap-1 text-sm">
          <span className="font-strong text-ink">
            {`${ballot.title}: ${ballot.winner}`}
          </span>
          <span className="text-ink-muted">{ballot.scores}</span>
          <p className="text-ink">{ballot.reason}</p>
        </div>
      ))}
    </section>
  );
}

function Download({ href }: { href: string }) {
  return (
    <section aria-label="Download" className={card}>
      <span className={label}>Download</span>
      {/* A plain link, so no prefetch spends the download allowance. */}
      <a href={href} className={buttonClass('secondary')}>
        Download video
      </a>
      <p className="text-sm text-ink-muted">
        A copy you download is outside Daisy. Removing this recording, taking it
        down or erasing an account cannot reach that copy.
      </p>
    </section>
  );
}

function Removal({
  roundId,
  removal,
}: {
  roundId: string;
  removal: NonNullable<History['removal']>;
}) {
  return (
    <form
      method="post"
      action={`/api/recordings/${removal.recordingId}/removal`}
      className={card}
    >
      <span className={label}>Remove this recording</span>
      <p className="text-sm text-ink-muted">
        Any participant can have a casual recording removed. The whole recording
        goes, for everyone.
      </p>
      <input type="hidden" name="roundId" value={roundId} />
      <input type="hidden" name="version" value={String(removal.version)} />
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="confirm" />
        Remove it for everyone
      </label>
      <button type="submit" className={buttonClass('secondary')}>
        Remove recording
      </button>
    </form>
  );
}

/**
 * A finished Round: its video or the honest reason there is none, its text history
 * and result where this viewer may read them, and what they may do with it. Each
 * panel appears only on its own permission.
 */
export function RecordingHistory({ screen, notice }: RecordingHistoryProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-4 px-6 pt-5 pb-8 max-compact:px-4">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href={watchRoutes.recordings} className="font-strong">
          Recordings
        </Link>
      </nav>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-strong text-accent">
            {screen.ranked ? 'Ranked' : 'Casual'}
          </span>
          <span className="text-sm text-ink-muted">{screen.date}</span>
        </div>
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {screen.title}
        </h1>
        <p className="text-base text-ink-muted">{screen.resolution}</p>
      </header>
      {notice ? (
        <p role="status" className="text-sm text-ink">
          {removalNotices[notice]}
        </p>
      ) : null}
      <div className="flex items-start gap-6 max-compact:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-4 max-compact:w-full">
          <Media media={screen.media} />
          {screen.transcript ? (
            <Transcript transcript={screen.transcript} />
          ) : null}
        </div>
        <div className="flex basis-1/3 flex-col gap-4 max-compact:w-full max-compact:basis-auto">
          {screen.result ? <Result result={screen.result} /> : null}
          <section aria-label="Sharing" className={card}>
            <span className={label}>Share and visibility</span>
            <div>
              <Badge tone={screen.visibility === 'private' ? 'gold' : 'accent'}>
                {screen.visibility}
              </Badge>
            </div>
            <p className="text-sm text-ink-muted">
              {VISIBILITY[screen.visibility]}
            </p>
            <div>
              <CopyLink path={`${watchRoutes.recordings}/${screen.roundId}`} />
            </div>
          </section>
          {screen.downloadHref ? <Download href={screen.downloadHref} /> : null}
          {screen.removal ? (
            <Removal roundId={screen.roundId} removal={screen.removal} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

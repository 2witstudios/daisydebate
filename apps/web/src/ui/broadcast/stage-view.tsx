type StageSeat = {
  readonly side: 'affirmative' | 'negative';
  readonly label: string;
  readonly floor: boolean;
};
export type StageSnapshot = {
  readonly phase: 'speech' | 'prep' | 'judging' | 'between' | 'slate';
  readonly clock: { readonly label: string; readonly endsAt: string } | null;
  readonly seats: readonly StageSeat[];
};

const slateCopy: Record<Exclude<StageSnapshot['phase'], 'speech'>, string> = {
  prep: 'Preparation',
  judging: 'Judges are deciding',
  between: 'Next speech soon',
  slate: 'Starting soon',
};

const remaining = (endsAt: string, nowMs: number) => {
  const total = Math.max(0, Math.ceil((Date.parse(endsAt) - nowMs) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Everything the audience's video shows, burned in so it cannot drift from the
 * media. Tiles sit in `tiles`; the branding bar sits below them and never covers
 * a debater, because this video is also the official feed for streamers.
 */
export function StageView(props: {
  readonly snapshot: StageSnapshot;
  readonly nowMs: number;
  readonly siteLink: string;
  readonly tiles: React.ReactNode;
}) {
  const { snapshot } = props;
  const live = snapshot.phase === 'speech';
  return (
    <main className="broadcast-stage">
      <header className="broadcast-stage-clock">
        <span>
          {live
            ? snapshot.clock?.label
            : slateCopy[snapshot.phase as keyof typeof slateCopy]}
        </span>
        {snapshot.clock ? (
          <strong>{remaining(snapshot.clock.endsAt, props.nowMs)}</strong>
        ) : null}
      </header>
      <section className="relative min-h-0">
        <div className={`flex h-full ${live ? 'visible' : 'invisible'}`}>
          {props.tiles}
        </div>
        <ul className="broadcast-stage-seats">
          {snapshot.seats.map((seat) => (
            <li key={seat.side} data-floor={seat.floor}>
              {seat.label}
              {seat.floor ? ' · speaking' : ''}
            </li>
          ))}
        </ul>
      </section>
      <footer className="broadcast-stage-brand">
        <span>Daisy Debate</span>
        <span>{props.siteLink}</span>
      </footer>
    </main>
  );
}

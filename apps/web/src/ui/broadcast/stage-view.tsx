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
    <main
      style={{
        width: 1280,
        height: 720,
        display: 'grid',
        gridTemplateRows: '64px 1fr 48px',
        background: '#14130f',
        color: '#fff',
        fontFamily: 'sans-serif',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 24px',
          fontSize: 28,
        }}
      >
        <span>
          {live
            ? snapshot.clock?.label
            : slateCopy[snapshot.phase as keyof typeof slateCopy]}
        </span>
        {snapshot.clock ? (
          <strong>{remaining(snapshot.clock.endsAt, props.nowMs)}</strong>
        ) : null}
      </header>
      <section style={{ position: 'relative', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            height: '100%',
            visibility: live ? 'visible' : 'hidden',
          }}
        >
          {props.tiles}
        </div>
        <ul
          style={{
            position: 'absolute',
            bottom: 8,
            left: 0,
            right: 0,
            display: 'flex',
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          {snapshot.seats.map((seat) => (
            <li
              key={seat.side}
              data-floor={seat.floor}
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: 24,
                fontWeight: seat.floor ? 700 : 400,
              }}
            >
              {seat.label}
              {seat.floor ? ' · speaking' : ''}
            </li>
          ))}
        </ul>
      </section>
      <footer
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 24px',
          fontSize: 20,
          background: '#000',
        }}
      >
        <span>Daisy Debate</span>
        <span>{props.siteLink}</span>
      </footer>
    </main>
  );
}

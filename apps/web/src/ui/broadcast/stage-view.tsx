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
    <main className="font-sans text-white grid h-[720px] w-[1280px] grid-rows-[64px_1fr_48px] overflow-hidden bg-[#14130f]">
      <header className="flex items-center justify-between px-6 text-[28px]">
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
        <ul className="absolute inset-x-0 bottom-2 m-0 flex list-none p-0">
          {snapshot.seats.map((seat) => (
            <li
              key={seat.side}
              data-floor={seat.floor}
              className={`flex-1 text-center text-2xl ${seat.floor ? 'font-bold' : 'font-normal'}`}
            >
              {seat.label}
              {seat.floor ? ' · speaking' : ''}
            </li>
          ))}
        </ul>
      </section>
      <footer className="bg-black flex items-center justify-between px-6 text-xl">
        <span>Daisy Debate</span>
        <span>{props.siteLink}</span>
      </footer>
    </main>
  );
}

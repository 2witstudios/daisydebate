import type { ReactNode } from 'react';
import type { DestinationSlug } from '../../../../features/destinations/destinations';
import type { SeasonGlance } from '../../../../features/leaderboard/season';

const Swords = () => (
  <>
    <g className="note-glyph-spark">
      <path d="M12 2v2" />
      <path d="m8.5 3 1 1.5" />
      <path d="m15.5 3-1 1.5" />
    </g>
    <g className="note-glyph-sword-right">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6" />
      <path d="m16 16 4 4" />
      <path d="m19 21 2-2" />
    </g>
    <g className="note-glyph-sword-left">
      <path d="M14.5 6.5 18 3h3v3l-3.5 3.5" />
      <path d="m5 14 4 4" />
      <path d="m7 17-4 4" />
      <path d="m3 19 2 2" />
    </g>
  </>
);

const Eye = () => (
  <g className="note-glyph-eye">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </g>
);

const Gavel = () => (
  <>
    <g className="note-glyph-impact">
      <path d="m22 15 2-1" />
      <path d="M22.5 18.5h2" />
      <path d="m21 21.5 1.5 1.5" />
    </g>
    <g className="note-glyph-gavel">
      <path d="m14 13-8.5 8.5a2.12 2.12 0 0 1-3-3L11 10" />
      <path d="m16 16 6-6" />
      <path d="m8 8 6-6" />
      <path d="m9 7 8 8" />
      <path d="m21 11-8-8" />
    </g>
  </>
);

const confetti = [
  ['note-glyph-confetti-gold', 'M3 3h.01'],
  ['note-glyph-confetti-clay', 'M21 2h.01'],
  ['note-glyph-confetti-sky', 'M1 11h.01'],
  ['note-glyph-confetti-teal', 'M23 10h.01'],
  ['note-glyph-confetti-plum', 'M12 1h.01'],
  ['note-glyph-confetti-gold', 'M6 1h.01'],
  ['note-glyph-confetti-sky', 'M18 1h.01'],
] as const;

const Trophy = () => (
  <>
    {confetti.map(([tone, d]) => (
      <path key={d} d={d} className={`note-glyph-confetti ${tone}`} />
    ))}
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </>
);

const Calendar = ({ number }: { readonly number: number | undefined }) => (
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4" />
    <path d="M8 2v4" />
    <path d="M3 10h18" />
    <rect
      x="3"
      y="10"
      width="18"
      height="12"
      rx="2"
      className="note-glyph-page"
    />
    {number === undefined ? null : (
      <text x="12" y="19.5" textAnchor="middle" className="note-glyph-number">
        {number}
      </text>
    )}
  </>
);

const Chart = () => (
  <>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M7 16v-3" className="note-glyph-bar-short" />
    <path d="M12 16V8" className="note-glyph-bar-tall" />
    <path d="M17 16v-5" className="note-glyph-bar-middle" />
  </>
);

const Brain = () => (
  <g className="note-glyph-brain">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
    <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
    <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
    <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
    <path d="M6 18a4 4 0 0 1-1.967-.516" />
    <path d="M19.967 17.484A4 4 0 0 1 18 18" />
  </g>
);

const Book = () => (
  <>
    <g className="note-glyph-book-open">
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </g>
    <g className="note-glyph-book-cover">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <path d="M6.5 2H20v15H6.5" />
    </g>
  </>
);

const artOf = (
  destination: DestinationSlug,
  number: number | undefined,
): ReactNode => {
  switch (destination) {
    case 'lobby':
      return <Swords />;
    case 'watch':
      return <Eye />;
    case 'judge':
      return <Gavel />;
    case 'tournaments':
      return <Trophy />;
    case 'seasons':
      return <Calendar number={number} />;
    case 'leaderboard':
      return <Chart />;
    case 'train':
      return <Brain />;
    case 'prep':
      return <Book />;
  }
};

/**
 * A destination's icon on its Home note. At rest it draws the same picture as
 * the shared icon; hovering or focusing the note plays its motion, in CSS alone
 * (`theme/note-glyphs.css`). Decorative: the Seasons page carries the facts.
 */
export function NoteGlyph({
  destination,
  seasonGlance = null,
}: {
  readonly destination: DestinationSlug;
  /** Revealed on the Seasons note only; null when no season is running. */
  readonly seasonGlance?: SeasonGlance | null;
}) {
  return (
    <span className="flex items-center gap-3" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width={28}
        height={28}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="block shrink-0 note-glyph"
      >
        {artOf(destination, seasonGlance?.number)}
      </svg>
      {seasonGlance === null ? null : (
        <span className="text-sm whitespace-nowrap note-glyph-reveal max-narrow:hidden">
          {seasonGlance.line}
        </span>
      )}
    </span>
  );
}

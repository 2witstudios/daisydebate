import { bracketArt } from './bracket-art-paths';

const art = bracketArt(8, { left: 12, right: 288, top: 14, bottom: 166 });

/** Decorative bracket lines for the featured card: one connected tree. */
export function BracketArt() {
  return (
    <svg
      viewBox="0 0 300 180"
      width="300"
      height="180"
      aria-hidden="true"
      className="text-stage-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {art.rounds.map((d, level) => (
        <path key={d} d={d} opacity={0.5 + level * 0.15} />
      ))}
      <path d={art.champion} />
      <circle cx={art.dot.x} cy={art.dot.y} r="5" fill="currentColor" />
    </svg>
  );
}

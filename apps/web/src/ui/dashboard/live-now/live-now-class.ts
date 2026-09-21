export type CompetitorSide = 'home' | 'away';

const base = 'flex min-w-0 items-center gap-2';

const sides: Readonly<Record<CompetitorSide, string>> = {
  home: '',
  away: 'flex-row-reverse text-right',
};

/** Layout of one competitor cell; the away side mirrors the home side. */
export const competitorClass = (side: CompetitorSide): string =>
  `${base} ${sides[side]}`.trim();

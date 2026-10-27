import type { RoomView } from '@daisy/protocol';
import {
  resolutionCategoryLabel,
  strikeLabel,
} from '../../../features/debate-room/vocabulary';
import { nameOf, viewerSideOf } from './room-strike';

/**
 * After the reveal, the debaters' record of how their resolution was chosen
 * (FMT-7.2): the kept resolution's category and every strike in order. Only
 * a debater's view carries the drawn texts, so everyone else sees nothing
 * here; the revealed topic reaches them through the Room's resolution.
 */
export function RoomStrikeReveal({
  view,
  actorId,
}: {
  readonly view: RoomView;
  readonly actorId: string;
}) {
  const draw = view.resolutionDraw;
  if (!draw?.revealedAt || draw.visibility !== 'debater') return null;
  const viewerSide = viewerSideOf(view, actorId);
  const struckAt = new Map(draw.strikes.map((s) => [s.position, s]));
  const kept = draw.items.find((item) => !struckAt.has(item.position));
  const ordered = [...draw.items].sort(
    (a, b) =>
      (struckAt.get(a.position)?.ordinal ?? Infinity) -
      (struckAt.get(b.position)?.ordinal ?? Infinity),
  );
  return (
    <details className="rounded-xl border border-border bg-surface-raised px-6 py-4">
      <summary className="min-h-room-target cursor-pointer text-sm font-strong">
        How it was chosen
        {kept?.category
          ? ` · a ${resolutionCategoryLabel[kept.category].toLowerCase()} resolution`
          : ''}
      </summary>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {ordered.map((item) => {
          const strike = struckAt.get(item.position);
          return (
            <li key={item.position} className="flex flex-col gap-1">
              <span
                className={
                  strike ? 'text-ink-muted line-through' : 'font-strong'
                }
              >
                {item.text}
              </span>
              <span className="text-xs text-ink-muted">
                {item.category
                  ? `${resolutionCategoryLabel[item.category]} · `
                  : ''}
                {strike
                  ? strikeLabel(strike, viewerSide, (side) =>
                      nameOf(view, side),
                    )
                  : 'Debated'}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

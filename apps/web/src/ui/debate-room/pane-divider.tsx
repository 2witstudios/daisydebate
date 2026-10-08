'use client';

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { paneBounds, type Pane } from '../../features/debate-room/layout';
import { cn } from '../cn';

type Props = {
  readonly pane: Pane;
  readonly label: string;
  readonly value: number;
  readonly onResize: (startPx: number, deltaPx: number) => void;
  readonly onNudge: (key: string) => void;
};

/**
 * A drag handle between two panes. Pointer capture keeps the drag on the
 * handle without window listeners; arrow keys nudge it for keyboard users.
 */
export function PaneDivider({ pane, label, value, onResize, onNudge }: Props) {
  const drag = useRef<{ start: number; origin: number } | null>(null);
  const vertical = pane !== 'video';
  const coordinate = (event: PointerEvent) =>
    vertical ? event.clientX : event.clientY;

  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: value, origin: coordinate(event) };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(drag.current.start, coordinate(event) - drag.current.origin);
  };
  const up = () => {
    drag.current = null;
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    onNudge(event.key);
  };

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={paneBounds[pane].min}
      aria-valuemax={paneBounds[pane].max}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      className={cn(
        'group flex shrink-0 touch-none items-center justify-center bg-background outline-none focus-visible:bg-surface-overlay',
        vertical
          ? 'w-2 cursor-col-resize border-x border-border'
          : 'h-2 cursor-row-resize border-t border-border',
      )}
    >
      <span
        className={cn(
          'rounded-round bg-border-strong transition-colors group-hover:bg-ink-faint',
          vertical ? 'h-10 w-1' : 'h-1 w-10',
        )}
      />
    </div>
  );
}

'use client';

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

type Props = {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onResize: (startPx: number, deltaPx: number) => void;
  readonly onNudge: (key: string) => void;
};

/**
 * The handle between the video and the document: only the video resizes.
 * Pointer capture keeps the drag on the handle without window listeners;
 * arrow keys nudge it for keyboard users.
 */
export function VideoDivider({ value, min, max, onResize, onNudge }: Props) {
  const drag = useRef<{ start: number; origin: number } | null>(null);
  const coordinate = (event: PointerEvent) => event.clientY;

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
      aria-orientation="horizontal"
      aria-label="Resize video"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      className="group flex h-room-target shrink-0 cursor-row-resize touch-none items-center justify-center bg-background focus-visible:bg-surface-overlay focus-visible:shadow-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-narrow:hidden"
    >
      <span className="h-1 w-10 rounded-round bg-border-strong transition-colors group-hover:bg-ink-faint" />
    </div>
  );
}

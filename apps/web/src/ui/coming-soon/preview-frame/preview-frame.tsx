import type { ReactNode } from 'react';

export type PreviewFrameProps = {
  readonly children: ReactNode;
};

/**
 * A picture of the finished page, not the page: the content is laid out at
 * twice the frame's width, scaled to half, inert and hidden from assistive
 * technology so nothing inside it can be focused, clicked or announced. One
 * frame serves every destination; each supplies its own preview content.
 */
export function PreviewFrame({ children }: PreviewFrameProps) {
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-col gap-1">
        <span className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          Preview
        </span>
        <span className="text-sm text-ink-faint">
          Sample data. The finished page will look like this.
        </span>
      </figcaption>
      <div
        inert
        aria-hidden="true"
        className="pointer-events-none aspect-square overflow-hidden rounded-xl border border-border bg-background shadow-1 select-none"
      >
        <div className="w-2/1 origin-top-left scale-50">{children}</div>
      </div>
    </figure>
  );
}

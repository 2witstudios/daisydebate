import { useRef } from 'react';
import { useAnswer, useDeliver } from './use-answer';
import { useMediaQuery } from './use-dom-events';
import { useResource, type Disposable } from './use-driver';
import { useFocusOnChange, useFocusOnLeave } from './use-focus';
import { useDelay, useTick } from './use-tick';
import { useSettled } from './use-settled';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

export function HeldResource({
  resourceKey,
  open,
  seen,
}: {
  readonly resourceKey: string | null;
  readonly open: (
    key: string,
  ) => (Disposable & { readonly name: string }) | null;
  readonly seen: (name: string | null) => void;
}) {
  const held = useResource(resourceKey, (key) =>
    key === null ? null : open(key),
  );
  seen(held?.name ?? null);
  return null;
}

export function Answered({
  answer,
  told,
}: {
  readonly answer: string;
  readonly told: (answer: string) => void;
}) {
  useAnswer(answer, told);
  return null;
}

export function Delivered({
  value,
  told,
}: {
  readonly value: string;
  readonly told: (value: string) => void;
}) {
  useDeliver(value, told);
  return null;
}

export function Waiting({
  waitMs,
  waitKey,
  run,
}: {
  readonly waitMs: number | null;
  readonly waitKey?: string;
  readonly run: () => void;
}) {
  useDelay(run, waitMs, waitKey);
  return null;
}

export function Ticking({
  everyMs,
  run,
}: {
  readonly everyMs: number | null;
  readonly run: () => void;
}) {
  useTick(run, everyMs);
  return null;
}

export function Matching({ query }: { readonly query: string }) {
  return <output>{String(useMediaQuery(query))}</output>;
}

export function FocusOnChange({ step }: { readonly step: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusOnChange(step, () => ref.current?.focus());
  return <button ref={ref}>Step {step}</button>;
}

export function LeavingRow({ shown }: { readonly shown: boolean }) {
  return (
    <nav>
      {shown ? <Row /> : null}
      <button id="after">After</button>
    </nav>
  );
}

function Row() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusOnLeave(ref, (row) =>
    row.closest('nav')?.querySelector<HTMLElement>('#after'),
  );
  return (
    <div ref={ref}>
      <button id="inside">Inside</button>
    </div>
  );
}

export function Settled({
  readKey,
  read,
  seen,
}: {
  readonly readKey: string | null;
  readonly read: (key: string) => Promise<string>;
  readonly seen: (shown: string) => void;
}) {
  const settled = useSettled(readKey, read);
  seen(
    settled === null
      ? 'none'
      : settled.kind === 'ready'
        ? settled.value
        : 'failed',
  );
  return null;
}

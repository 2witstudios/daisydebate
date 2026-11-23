import { useRef, useState } from 'react';
import { Dialog, requestDialog } from './dialog';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

/** An opener, its dialog, and a control elsewhere that requests it. */
export function Opened({
  modal = true,
  closes,
}: {
  readonly modal?: boolean;
  readonly closes: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      <button id="elsewhere" onClick={() => requestDialog('title')}>
        Elsewhere
      </button>
      <Dialog
        open={open}
        modal={modal}
        onClose={() => {
          closes();
          setOpen(false);
        }}
        onOpenRequested={() => setOpen(true)}
        aria-labelledby="title"
      >
        <h2 id="title">Title</h2>
        <form method="dialog">
          <button id="inside">Done</button>
        </form>
      </Dialog>
    </>
  );
}

/** An in-place confirm shown on arrival, with a trigger to give focus back to. */
export function ShownOnArrival({ closes }: { readonly closes: () => void }) {
  const [open, setOpen] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button id="trigger" ref={trigger} onClick={() => setOpen(true)}>
        Leave
      </button>
      <Dialog
        open={open}
        modal={false}
        returnFocus={trigger}
        onClose={() => {
          closes();
          setOpen(false);
        }}
        aria-labelledby="confirm"
      >
        <h2 id="confirm">Leave?</h2>
        <button id="stay" onClick={() => setOpen(false)}>
          Stay
        </button>
      </Dialog>
    </>
  );
}

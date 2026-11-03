'use client';

/** This tab does not hold the Round, whether another tab does or the member left; only a press moves it. */
export function TabElsewhere({ takeOver }: { readonly takeOver: () => void }) {
  return (
    <>
      <p role="status">This Round is not open in this tab.</p>
      <button type="button" onClick={takeOver}>
        Use this tab
      </button>
    </>
  );
}

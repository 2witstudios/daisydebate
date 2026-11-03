'use client';

/** The Round is live in another tab of this browser; only an explicit press moves it. */
export function TabElsewhere({ takeOver }: { readonly takeOver: () => void }) {
  return (
    <>
      <p role="status">This Round is open in another tab.</p>
      <button type="button" onClick={takeOver}>
        Use this tab
      </button>
    </>
  );
}

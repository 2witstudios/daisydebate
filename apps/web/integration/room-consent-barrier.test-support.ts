/** Holds one consent read or write open until the suite releases it. */
export function consentBarrier(
  f: {
    gateConsent: (gate: (() => Promise<void>) | null) => void;
    gateReady: (gate: (() => Promise<void>) | null) => void;
  },
  kind: 'read' | 'write' = 'read',
) {
  const setGate = kind === 'read' ? f.gateConsent : f.gateReady;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    released = new Promise<void>((resolve) => {
      release = resolve;
    });
  setGate(async () => {
    setGate(null);
    enter();
    await released;
  });
  return { entered, release: () => release() };
}

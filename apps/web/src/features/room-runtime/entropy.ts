/**
 * 32 bytes of OS CSPRNG entropy as lowercase hex: a draw's seed and its
 * input-commitment salt. The one place a draw's randomness is created;
 * everything after it is a pure function the engine replays.
 */
export const drawEntropy = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

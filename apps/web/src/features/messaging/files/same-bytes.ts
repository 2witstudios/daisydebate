/** Bounded immutable object content comparison; never persisted or logged. */
export function sameFileBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, i) => byte === right[i])
  );
}

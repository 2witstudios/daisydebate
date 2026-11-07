/** Server instants are serialized through millisecond Date values: subtract their full quantization error. */
export function canStartTranscription(input: {
  readonly beforeAdmissionMs: number;
  readonly nowMs: number;
  readonly grant: { readonly admittedAt: string; readonly startBefore: string };
}): boolean {
  const remainingMs =
    Date.parse(input.grant.startBefore) -
    Date.parse(input.grant.admittedAt) -
    1;
  const deadline = Math.floor(input.beforeAdmissionMs) + remainingMs;
  return (
    [input.beforeAdmissionMs, input.nowMs, remainingMs, deadline].every(
      Number.isFinite,
    ) &&
    input.beforeAdmissionMs >= 0 &&
    input.beforeAdmissionMs <= Number.MAX_SAFE_INTEGER &&
    input.nowMs >= input.beforeAdmissionMs &&
    remainingMs > 0 &&
    remainingMs < 60000 &&
    deadline <= Number.MAX_SAFE_INTEGER &&
    deadline > input.beforeAdmissionMs &&
    input.nowMs < deadline
  );
}

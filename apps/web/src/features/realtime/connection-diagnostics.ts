/** Content-free transport phases; exception messages and credentials never enter this port. */
export type ConnectionDiagnostic = {
  readonly generation: number;
  readonly phase:
    'ticket-resolved' | 'ticket-failed' | 'hello-sent' | 'hello-failed';
  readonly errorName?: string;
};
function safeErrorName(error: unknown): string {
  const allowed = [
    'Error',
    'TypeError',
    'SyntaxError',
    'ReferenceError',
    'EvalError',
    'RangeError',
    'URIError',
    'InvalidStateError',
    'SecurityError',
    'RealtimeTicketFetchError',
    'RealtimeTicketBodyError',
    'RealtimeTicketSchemaError',
    'RealtimeTicketEndpointError',
  ];
  return error instanceof Error && allowed.includes(error.name)
    ? error.name
    : 'UnknownError';
}
export function createConnectionDiagnostics() {
  const listeners = new Set<(event: ConnectionDiagnostic) => void>();
  return {
    subscribe(listener: (event: ConnectionDiagnostic) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(
      generation: number,
      phase: ConnectionDiagnostic['phase'],
      error?: unknown,
    ) {
      const event: ConnectionDiagnostic =
        error === undefined
          ? { generation, phase }
          : { generation, phase, errorName: safeErrorName(error) };
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          /* Diagnostics cannot change transport behavior. */
        }
      }
    },
  };
}

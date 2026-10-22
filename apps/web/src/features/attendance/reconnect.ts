/** Owned by one mounted room; its existing resource-sync socket publishes opens. */
export function createAttendanceReconnect() {
  const listeners = new Set<() => void>();
  return {
    opened: () => {
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

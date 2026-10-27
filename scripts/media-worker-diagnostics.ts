import { describeCaptureExit } from '../apps/media-worker/src/capture-exit';

/** Keeps only enumerated worker evidence; no raw logs or native output escape. */
export function createCaptureProofDiagnostics() {
  const events: string[] = [];
  let capture = 'not observed';
  return {
    observe(line: string) {
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(line);
      } catch {
        return;
      }
      if (value === null || typeof value !== 'object') return;
      if (
        ['server.ready', 'server.shutdown', 'media.capture.failed'].includes(
          String(value.event),
        )
      ) {
        if (events.length === 64) events.shift();
        events.push(String(value.event));
      }
      if (
        value.event === 'media.capture.failed' &&
        typeof value.status === 'number'
      ) {
        const description = describeCaptureExit(value.status);
        capture = `${description.cause}/${description.errorCode ?? 'unknown'}`;
      }
      if (
        value.event === 'server.shutdown' &&
        ['configuration', 'database', 'privilege'].includes(String(value.cause))
      )
        capture = `worker-${value.cause}`;
    },
    events: () => [...events],
    failure: (exitCode: number | null) =>
      `Capture proof hidden-join failed: worker exit ${exitCode ?? 'running'}; capture ${capture}`,
  };
}

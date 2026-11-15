/** Read child pipes without exposing incidental SDK output or raw exceptions. */
export async function readDtxOutput(
  stdout: ReadableStream<Uint8Array>,
  stderr: ReadableStream<Uint8Array>,
) {
  const [out, err] = await Promise.all([
    new Response(stdout).text(),
    new Response(stderr).arrayBuffer(),
  ]);
  const all = out.split('\n').filter((line) => line.length > 0);
  const events = [
    'native.capture.dtxOrder.environment',
    'native.capture.dtxOrder.publication',
    'native.capture.dtxOrder.failure',
    'native.capture.dtxOrder.resources',
  ];
  const lines = all.filter((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return (
        value !== null &&
        typeof value === 'object' &&
        'event' in value &&
        typeof value.event === 'string' &&
        events.includes(value.event)
      );
    } catch {
      return false;
    }
  });
  return {
    lines,
    stderrBytes: err.byteLength,
    ignoredStdoutLines: all.length - lines.length,
  };
}

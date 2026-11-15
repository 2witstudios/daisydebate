/** Keep acquisition, native disposal and resource reporting inside one boundary. */
export async function captureDtxFailures(input: {
  readonly acquire: () => Promise<void>;
  readonly dispose: () => Promise<void>;
  readonly resources: () => Promise<void>;
  readonly report: (stage: 'acquire' | 'dispose' | 'resources') => void;
}) {
  const attempt = async (
    stage: Parameters<typeof input.report>[0],
    work: () => Promise<void>,
  ) => {
    try {
      await work();
      return true;
    } catch {
      input.report(stage);
      return false;
    }
  };
  const acquired = await attempt('acquire', input.acquire);
  const disposed = await attempt('dispose', input.dispose);
  const reported = await attempt('resources', input.resources);
  return acquired && disposed && reported;
}

import { z } from 'zod';

const edgeSchema = z.strictObject({
  port: z.int().min(1024).max(65535),
  upstreamPort: z.int().min(1024).max(65535),
});
export const launchMediaEdgesSchema = z.array(edgeSchema);

/**
 * A local proof's scratch nodes sit behind TLS edges and their own UDP ports,
 * which the browser's container must forward; rented nodes need neither.
 */
export function drillBrowserPorts(
  env: Readonly<Record<string, string | undefined>>,
) {
  const edges = env.ROOM_LAUNCH_MEDIA_EDGES
    ? launchMediaEdgesSchema.parse(JSON.parse(env.ROOM_LAUNCH_MEDIA_EDGES))
    : [];
  const nodes = z
    .array(z.object({ media: z.string() }))
    .parse(JSON.parse(env.DRILL_NODES ?? '[]'));
  const udpPorts = nodes.flatMap(({ media }) => {
    const port = /^127\.0\.0\.1:(\d+)$/.exec(media)?.[1];
    return port ? [Number(port)] : [];
  });
  return {
    extraPorts: edges.map((edge) => edge.port),
    ...(udpPorts.length ? { udpPorts } : {}),
  };
}

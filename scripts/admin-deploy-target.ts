import { z } from 'zod';

const machinesSchema = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9]+$/),
    state: z.string(),
    config: z.object({
      metadata: z.object({
        fly_platform_version: z.string(),
        fly_process_group: z.string(),
      }),
      mounts: z
        .array(z.object({ volume: z.string(), path: z.string() }))
        .nullish()
        .transform((value) => value ?? []),
    }),
  }),
);
const volumesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    region: z.string(),
    encrypted: z.boolean(),
  }),
);

/** Fail closed before Fly deploy can touch a volumeless or duplicate identity. */
export function adminDeployTarget(
  machines: unknown,
  volumes: unknown,
): string | null {
  const parsed = machinesSchema.safeParse(machines);
  const storage = volumesSchema.safeParse(volumes);
  if (!parsed.success || !storage.success) return null;
  const ids = storage.data
    .filter(
      (volume) =>
        volume.name === 'admin_tailscale_state' &&
        volume.region === 'ord' &&
        volume.encrypted,
    )
    .map((volume) => volume.id);
  const candidates = parsed.data.filter(
    (machine) =>
      machine.config.metadata.fly_platform_version === 'v2' &&
      machine.config.metadata.fly_process_group === 'app' &&
      machine.config.mounts.length === 1 &&
      machine.config.mounts.some(
        (mount) =>
          ids.includes(mount.volume) && mount.path === '/var/lib/tailscale',
      ),
  );
  const target = candidates[0];
  return candidates.length === 1 &&
    target &&
    parsed.data.every(
      (machine) => machine.id === target.id || machine.state === 'stopped',
    )
    ? target.id
    : null;
}

if (import.meta.main) {
  try {
    const target = adminDeployTarget(
      JSON.parse(await Bun.stdin.text()),
      JSON.parse(await Bun.file(process.argv[2] ?? '').text()),
    );
    if (!target) throw new Error('Invalid target');
    process.stdout.write(`${target}\n`);
  } catch {
    process.stderr.write(
      'Admin deploy requires exactly one managed persistent node and all other machines stopped; follow private-admin.md initial adoption\n',
    );
    process.exitCode = 1;
  }
}

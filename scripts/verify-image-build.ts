import { uncommented } from './deploy-config-text';

/**
 * ISSUE-527: the image's `next build` skips its own TypeScript pass, which
 * stalled Fly's remote builder for 25+ minutes and is a duplicate: CI's
 * typecheck gates every commit deploy-staging ships (staging-gate.ts). The
 * skip must stay scoped to the image, so `bun run build` and `bun check`
 * still typecheck: next.config.ts keys it on DAISY_IMAGE_BUILD alone, and
 * only the Dockerfile's build stage sets that.
 */
export function findImageTypecheckProblem(input: {
  readonly dockerfile: string;
  readonly nextConfig: string;
}): string | null {
  const config = uncommented(input.nextConfig);
  const scoped =
    /ignoreBuildErrors:\s*process\.env\.DAISY_IMAGE_BUILD === '1'/.test(
      config,
    ) && (config.match(/ignoreBuildErrors/g) ?? []).length === 1;
  const docker = uncommented(input.dockerfile);
  const settings = docker.match(/DAISY_IMAGE_BUILD=1/g) ?? [];
  const inBuild =
    /RUN DAISY_IMAGE_BUILD=1 NODE_ENV=production bun run --cwd apps\/web build/.test(
      docker,
    );
  return scoped && inBuild && settings.length === 1
    ? null
    : "next.config.ts must skip type errors only for the image build (ignoreBuildErrors: process.env.DAISY_IMAGE_BUILD === '1'), and only the Dockerfile build stage may set DAISY_IMAGE_BUILD=1; CI typechecks every deployed commit";
}

/**
 * fly.toml and fly.migrate.toml build apps/web/Dockerfile's default target,
 * its last stage, so the web `runtime` stage must stay last; the service
 * stages are selected only by their own build-target (ISSUE-528).
 */
export function findDefaultStageProblem(dockerfile: string): string | null {
  const stages = [
    ...uncommented(dockerfile).matchAll(/^FROM \S+ AS (\S+)\s*$/gm),
  ];
  return stages.at(-1)?.[1] === 'runtime'
    ? null
    : 'apps/web/Dockerfile must end with the `runtime` stage: fly.toml and fly.migrate.toml build the default (last) target';
}

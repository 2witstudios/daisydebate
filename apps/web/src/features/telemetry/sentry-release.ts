/**
 * The Sentry release of a running image: its full git commit, the value
 * `GIT_COMMIT` carries from the deploy (apps/web/Dockerfile). The source-map
 * upload at build time and every runtime's events name the same release, so
 * the browser, the server and the uploaded maps line up. The unset default
 * `unknown` (local development) names no release at all.
 */
export const sentryRelease = (
  gitCommit: string | undefined,
): string | undefined =>
  gitCommit && gitCommit !== 'unknown' ? gitCommit : undefined;

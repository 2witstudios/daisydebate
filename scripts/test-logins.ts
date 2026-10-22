/** The browser suite's server login: daisy_web only. */
export const e2eRole = {
  user: 'daisy_e2e',
  password: 'e2e-loopback-only',
  memberOf: 'daisy_web',
} as const;
/** The capture worker's loopback login (VIDEO-3.13): daisy_media_worker only. */
export const mediaWorkerRole = {
  user: 'daisy_media_worker_local',
  password: 'media-worker-loopback-only',
  memberOf: 'daisy_media_worker',
} as const;
/**
 * Every loopback-only login `provisionTestRoles` creates on local and CI
 * clusters. Each inherits exactly one migration-created runtime role.
 */
export const testLogins = [e2eRole, mediaWorkerRole] as const;

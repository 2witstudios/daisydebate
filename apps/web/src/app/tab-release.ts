/**
 * Tab's published release check, for the pages outside Tab's route groups
 * that only adapt to it: the onboarding intro and the public Tournaments
 * page. They read no Tab data, so they stay out of the groups whose
 * layouts refuse until the release opens (`release-gate.test.ts`).
 */
export { tabReleased } from '../features/tab/release';

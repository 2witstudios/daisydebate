/**
 * A Youth Round's linked adults for its live audience and its Recording
 * (ADR 0150, ADR 0155): the 15-second people cache and the resolver over it.
 * Pure over injected reads, so the web and the realtime server each compose
 * their own.
 */
export { YOUTH_PEOPLE_TTL_MS, youthPeopleCache } from './youth-people-cache';
export { youthRoundLinkedAdults } from './youth-round-linked-adults';

/**
 * A Youth Round's linked adults, as its live audience reads them (ADR 0155):
 * the actors of every youth debater's coaches and guardians. A read supplies
 * it only for a Youth Round; every other Round has none (null).
 */
export type YouthLiveFact = {
  readonly linkedAdultActorIds: readonly string[];
};

import type { RoomPolicy } from '../../src/features/room-runtime/composition';
/** Local fixture choices only; importing this does not activate any process. */
export const launchProofPolicy: RoomPolicy = {
  consentTtlMs: 600_000,
  maxOpenRooms: 10,
  maxBodyBytes: 262_144,
  limits: {
    create: { max: 20, windowSeconds: 60 },
    read: { max: 500, windowSeconds: 60 },
    command: { max: 200, windowSeconds: 60 },
  },
};

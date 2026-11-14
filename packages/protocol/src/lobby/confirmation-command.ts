import { z } from 'zod';
import { idSchema } from '../primitives';
import { lobbyCommandEnvelope, type LobbyCommandCatalogue } from './command';

/**
 * Confirmation commands (TAB-5.12, aggregate `pending_command`). A command a
 * conflict holds for a second person is stored whole and settled once: it is
 * confirmed (re-run against current versions, re-authorizing its proposer),
 * declined, or withdrawn by its proposer. A conflicted read asks for a waiver
 * through the same lifecycle.
 */

const pendingCommandRef = { pendingCommandId: idSchema };

export const confirmCommandCommandSchema = z.strictObject({
  type: z.literal('confirm-command'),
  ...pendingCommandRef,
});

export const declineCommandCommandSchema = z.strictObject({
  type: z.literal('decline-command'),
  ...pendingCommandRef,
});

export const withdrawCommandCommandSchema = z.strictObject({
  type: z.literal('withdraw-command'),
  ...pendingCommandRef,
});

/** The reads a conflicted holder may ask a waiver for. */
export const waivableCapabilities = [
  'round.observe.undelayed',
  'tournament.ballots.read_unreleased',
] as const;

export const requestConflictWaiverCommandSchema = z.strictObject({
  type: z.literal('request-conflict-waiver'),
  fixtureId: idSchema,
  capability: z.enum(waivableCapabilities),
});

export const confirmationCommandSchema = z.discriminatedUnion('type', [
  confirmCommandCommandSchema,
  declineCommandCommandSchema,
  withdrawCommandCommandSchema,
  requestConflictWaiverCommandSchema,
]);
export type ConfirmationCommand = z.infer<typeof confirmationCommandSchema>;
export const confirmationCommandEnvelopeSchema = lobbyCommandEnvelope(
  confirmationCommandSchema,
);

export const confirmationCommandRefusals = [
  'pending-settled',
  'pending-expired',
  'proposer-closed',
  'proposer-unauthorized',
  'waiver-exists',
  'handling-not-confirming',
] as const;
export type ConfirmationCommandRefusal =
  (typeof confirmationCommandRefusals)[number];
export const confirmationCommandRefusalSchema = z.enum(
  confirmationCommandRefusals,
);

export const confirmationCommandCatalogue = {
  'confirm-command': {
    aggregate: 'pending_command',
    gate: ['command.confirm'],
    versions: [],
    refusals: [
      'pending-settled',
      'pending-expired',
      'proposer-closed',
      'proposer-unauthorized',
    ],
    history: 'entry',
  },
  'decline-command': {
    aggregate: 'pending_command',
    gate: ['command.confirm'],
    versions: [],
    refusals: ['pending-settled'],
    history: 'entry',
  },
  'withdraw-command': {
    aggregate: 'pending_command',
    gate: ['command.withdraw'],
    versions: [],
    refusals: ['pending-settled'],
    history: 'entry',
  },
  'request-conflict-waiver': {
    aggregate: 'fixture',
    gate: waivableCapabilities,
    versions: [],
    refusals: ['waiver-exists', 'handling-not-confirming'],
    history: 'entry',
  },
} as const satisfies LobbyCommandCatalogue<ConfirmationCommand>;

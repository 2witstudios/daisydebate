import { z } from 'zod';
import type { LobbyCommandDefinition } from './command';
import {
  confirmationCommandCatalogue,
  confirmationCommandSchema,
} from './confirmation-command';
import { drawCommandCatalogue, drawCommandSchema } from './draw-command';
import {
  entryCommandCatalogue,
  entryCommandSchema,
  judgeCommandCatalogue,
  judgeCommandSchema,
} from './entry-command';
import {
  fixtureCommandCatalogue,
  fixtureCommandSchema,
} from './fixture-command';
import {
  guardianCommandCatalogue,
  guardianCommandSchema,
} from './guardian-command';
import {
  lobbySetupCommandCatalogue,
  lobbySetupCommandSchema,
} from './lobby-setup-command';
import {
  organizationCommandCatalogue,
  organizationCommandSchema,
} from './organization-command';
import {
  releaseCommandCatalogue,
  releaseCommandSchema,
  resultCommandCatalogue,
  resultCommandSchema,
} from './result-command';
import {
  sanctionCommandCatalogue,
  sanctionCommandSchema,
} from './sanction-command';
import {
  settingCommandCatalogue,
  settingCommandSchema,
} from './setting-command';

/**
 * Every lobby, organization and tab command, by group: its union and its
 * catalogue. The one list the catalogue check iterates (TAB-5.16).
 */
export const lobbyCommandGroups = {
  organization: [organizationCommandSchema, organizationCommandCatalogue],
  guardian: [guardianCommandSchema, guardianCommandCatalogue],
  setting: [settingCommandSchema, settingCommandCatalogue],
  lobbySetup: [lobbySetupCommandSchema, lobbySetupCommandCatalogue],
  entry: [entryCommandSchema, entryCommandCatalogue],
  judge: [judgeCommandSchema, judgeCommandCatalogue],
  draw: [drawCommandSchema, drawCommandCatalogue],
  fixture: [fixtureCommandSchema, fixtureCommandCatalogue],
  result: [resultCommandSchema, resultCommandCatalogue],
  release: [releaseCommandSchema, releaseCommandCatalogue],
  sanction: [sanctionCommandSchema, sanctionCommandCatalogue],
  confirmation: [confirmationCommandSchema, confirmationCommandCatalogue],
} as const satisfies Record<
  string,
  readonly [
    z.ZodDiscriminatedUnion,
    Readonly<Record<string, LobbyCommandDefinition>>,
  ]
>;
export type LobbyCommandGroup = keyof typeof lobbyCommandGroups;

/** Every command type with its definition, across every group. */
export const lobbyCommandCatalogue: Readonly<
  Record<string, LobbyCommandDefinition>
> = Object.assign(
  {},
  ...Object.values(lobbyCommandGroups).map(([, catalogue]) => catalogue),
);

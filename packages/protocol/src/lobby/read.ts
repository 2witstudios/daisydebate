import type { AuthorizationCapability } from '../authorization';

/**
 * What every lobby read declares: the one gate it answers under. A denied
 * read answers as a missing resource. `signed-in` reads list only what each
 * thing listed allows.
 */
export type LobbyReadDefinition = {
  readonly gate:
    | 'signed-in'
    | readonly [AuthorizationCapability, ...AuthorizationCapability[]];
};

/** One definition per read a group owns, keyed by the read's name. */
export type LobbyReadCatalogue<Name extends string> = {
  readonly [Read in Name]: LobbyReadDefinition;
};

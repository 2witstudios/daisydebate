import { idSchema } from '@daisy/protocol/primitives';
import {
  hostRosterViewSchema,
  type HostRosterView,
} from '@daisy/protocol/lobby/entry-read';
import { z } from 'zod';
import type { MemberBoundary } from '../auth/member-boundary';
import { bindTabRead } from './read-route';
import type { TabPrincipal } from './tab-principal';
const query = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema.optional(),
});
export const hostRosterPath = (lobbyId: string, eventId?: string): string =>
  `/api/tab/host-roster?${new URLSearchParams({ lobbyId, ...(eventId ? { eventId } : {}) })}`;
export const createHostRosterRoute = (dependencies: {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    input: z.infer<typeof query>,
  ) => Promise<HostRosterView | null>;
}) =>
  bindTabRead({
    ...dependencies,
    name: 'tab.host.roster',
    query,
    view: hostRosterViewSchema,
  });

import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { sanctionCommandEnvelopeSchema } from '@daisy/protocol/lobby/sanction-command';
import {
  createTabCommandRoute,
  type TabCommandRouteDependencies,
} from './command-route';
import { sanctionCommand } from './operations/sanction-command';
const addressed = z.strictObject({
  organizationId: idSchema,
  lobbyId: idSchema,
  envelope: sanctionCommandEnvelopeSchema,
});
export const createSanctionCommandRoute = (
  dependencies: Parameters<typeof sanctionCommand>[0] &
    Pick<TabCommandRouteDependencies, 'boundary' | 'released'>,
) => {
  const execute = sanctionCommand(dependencies);
  return createTabCommandRoute({
    ...dependencies,
    name: 'tab.sanction.command',
    address: 'none',
    execute: async (principal, body) => {
      const parsed = addressed.safeParse(body);
      if (!parsed.success) throw createAppError('VALIDATION');
      return execute(principal, parsed.data, parsed.data.envelope);
    },
  });
};

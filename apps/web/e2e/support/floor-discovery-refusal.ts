import { refuseCapacity } from '@daisy/db/testing';
import { idSchema } from '@daisy/protocol/primitives';
import { z } from 'zod';
import type { IncomingMessage } from 'node:http';
import type { App } from '../../src/server/app';

const targetSchema = z.strictObject({ roundId: idSchema, actorId: idSchema });

/** Refuse one matching discovery at the database boundary, through the real HTTP handler. */
export function floorDiscoveryRefusal(database: App['database']) {
  const floorStore = database.roundFloorStore.bind(database);
  let target: z.infer<typeof targetSchema> | null = null;
  database.roundFloorStore = (...args) => {
    const store = floorStore(...args);
    return {
      ...store,
      discover: (scope) => {
        if (
          target?.roundId !== scope.roundId ||
          target.actorId !== scope.actorId
        )
          return store.discover(scope);
        target = null;
        return Promise.reject(
          refuseCapacity({ lane: 'social', reason: 'expired' }),
        );
      },
    };
  };
  return async (request: IncomingMessage) => {
    let body = '';
    for await (const chunk of request) {
      body += String(chunk);
      if (Buffer.byteLength(body) > 256)
        throw new Error('Invalid Floor refusal selector');
    }
    target = targetSchema.parse(JSON.parse(body));
  };
}

import { assert, setupRitewayBun, test } from 'riteway/bun';
import { migrateRouteParams } from './migrate-app-route-params';

setupRitewayBun();

const legacy = `import { processRoute } from '../../../server/process-app';
export const GET = processRoute(
  (routes) => (request) =>
    routes.rooms.read(request, new URL(request.url).pathname.split('/')[3] ?? ''),
);
`;

test('uses the dynamic segment name in the Next.js route group', () => {
  const file = '(shell)/api/rooms/[roomId]/route.ts';
  const actual = migrateRouteParams(file, legacy);
  assert({
    given: 'a standard route binding with a URL index matching its directory',
    should: 'use Next.js params, omitting the group, and be stable on a repeat',
    actual: [actual, migrateRouteParams(file, actual) === actual],
    expected: [
      `import { processRoute } from '../../../server/process-app';

type Params = Awaited<RouteContext<'/api/rooms/[roomId]'>['params']>;
export const GET = processRoute.withParams<Params>(
  (routes) => (request, { roomId }) =>
    routes.rooms.read(request, roomId),
);
`,
      true,
    ],
  });
});

test('leaves unfamiliar dynamic handlers alone', () => {
  assert({
    given: 'a wrong position, two parameter names or a catch-all binding',
    should: 'leave the files for a manual migration',
    actual: [
      migrateRouteParams('api/[roomId]/overview/route.ts', legacy),
      migrateRouteParams('api/rooms/[roomId]/[fileId]/route.ts', legacy),
      migrateRouteParams('api/rooms/[...path]/route.ts', legacy),
    ],
    expected: [legacy, legacy, legacy],
  });
});

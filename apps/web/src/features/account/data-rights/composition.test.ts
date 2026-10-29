import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { rejectionOf } from '@daisy/errors/testing';
import { exportSubjectData } from './composition';

setupRitewayBun();
const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const databaseExport = { users: [{ id: subject.userId }] };
const leases = [{ actorId: subject.actorId, channelId: 'c'.repeat(24) }];

/** The app slice the export merge touches, with the port scripted. */
const fakeApp = (port: {
  readonly export: (subject: {
    readonly userId: string;
    readonly actorId: string;
  }) => Promise<unknown>;
}) =>
  ({
    database: {
      exportPrivacySubject: async () => databaseExport,
      messagingTypingPrivacyPort: () => port,
    },
    redis: {},
  }) as unknown as Parameters<typeof exportSubjectData>[0];

test('the composed export joins the typing snapshot under its own key', async () => {
  const exported = await exportSubjectData(
    fakeApp({ export: async () => leases }),
  )(subject);
  assert({
    given: 'a database export and a live typing snapshot',
    should:
      'return both, the leases under their own distinct key, the database tables untouched',
    actual: [
      exported.users,
      exported.messaging_typing_leases,
      Object.keys(exported).length,
    ],
    expected: [databaseExport.users, leases, 2],
  });
});

test('a typing read failure refuses the whole export', async () => {
  const rejection = await rejectionOf(() =>
    exportSubjectData(
      fakeApp({
        export: async () => {
          throw createAppError(
            'INFRASTRUCTURE',
            undefined,
            new Error('redis down'),
          );
        },
      }),
    )(subject),
  );
  assert({
    given: 'a database export that succeeded and a failed typing read',
    should:
      'refuse the whole export with the port refusal, never a partial answer',
    actual: rejection.code,
    expected: 'INFRASTRUCTURE',
  });
});

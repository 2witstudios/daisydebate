import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { AssemblyCast } from './assembly-cast';

setupRitewayBun();

const nativeIntents = {
  action: async () => ({ values: {} }),
  commandIds: Array.from({ length: 6 }, (_, index) => ({
    claim: `claim-${index}`,
    assign: `assign-${index}`,
    remove: `remove-${index}`,
  })),
  leaveId: 'leave-command',
};

test('host cast controls carry actual bot actors and asymmetric declared seats', () => {
  const html = renderToStaticMarkup(
    <AssemblyCast
      view={assemblySnapshot}
      viewer={{
        actorId: assemblySnapshot.hostActorId,
        label: assemblySnapshot.hostLabel,
      }}
      bots={[
        {
          actorId: 't'.repeat(24),
          kind: 'bot',
          label: 'Stored judge bot',
          eligible: true,
        },
      ]}
      {...nativeIntents}
    />,
  );
  assert({
    given: 'a host, an actual stored eligible bot and two aff/three neg seats',
    should:
      'offer every native seat intent with version fences and actual targets rather than fake bot identities',
    actual: [
      html.includes('Affirmative 2'),
      html.includes('Negative 3'),
      html.includes('Stored judge bot'),
      html.includes('t'.repeat(24)),
      (html.match(/value="assign-seat"/g) ?? []).length,
      (html.match(/value="claim-seat"/g) ?? []).length,
      html.includes('name="expectedVersion" value="3"'),
    ],
    expected: [true, true, true, true, 6, 6, true],
  });
});

test('non-host cast has claim controls but no host assignment authority', () => {
  const view = {
    ...assemblySnapshot,
    capabilities: { ...assemblySnapshot.capabilities, host: false },
  };
  const html = renderToStaticMarkup(
    <AssemblyCast
      view={view}
      viewer={{ actorId: 'u'.repeat(24), label: 'Second member' }}
      bots={[]}
      {...nativeIntents}
    />,
  );
  assert({
    given: 'a permitted member who is not the host',
    should: 'show native self-claim without exposing assignment or removal',
    actual: [
      html.includes('value="claim-seat"'),
      html.includes('value="assign-seat"'),
      html.includes('value="remove-seat"'),
    ],
    expected: [true, false, false],
  });
});

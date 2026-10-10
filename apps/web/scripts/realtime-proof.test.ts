import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  realtimeProofProfile,
  assertRealtimeProofConfig,
} from '../e2e/support/realtime-profile';

setupRitewayBun();

test('dedicated realtime profiles select the two actual transport suites and reports', () => {
  assert({
    given: 'the two explicitly registered realtime profiles',
    should: 'select only their exact dedicated config, spec and report',
    actual: ['room', 'messaging'].map(realtimeProofProfile),
    expected: [
      {
        config: 'e2e/support/realtime-config.ts',
        spec: '**/realtime-room-delivery.e2e.ts',
        report: 'test-results/realtime-results.json',
      },
      {
        config: 'e2e/support/messaging-realtime-config.ts',
        spec: '**/messaging-realtime.e2e.ts',
        report: 'test-results/messaging-realtime-results.json',
      },
    ],
  });
});

test('missing or arbitrary profiles cannot select another server or bypass the dedicated suite', () => {
  const refused = [undefined, 'default', '--config', 'room-launch'].map(
    (name) => {
      try {
        realtimeProofProfile(name);
        return false;
      } catch (error) {
        return (
          error instanceof Error &&
          error.message ===
            'Realtime proof requires an explicit room or messaging profile'
        );
      }
    },
  );
  assert({
    given: 'absent, ordinary or command-shaped proof selectors',
    should: 'refuse every unsupported profile before process creation',
    actual: refused,
    expected: [true, true, true, true],
  });
});

test('selected config validation refuses wrong suites, shared output and missing reports', () => {
  const profile = realtimeProofProfile('room');
  const config = {
    testMatch: profile.spec,
    outputDir: 'test-results/realtime',
    reporter: [['json', { outputFile: profile.report }]],
  };
  const accepts = (input: Parameters<typeof assertRealtimeProofConfig>[1]) => {
    try {
      assertRealtimeProofConfig(profile, input);
      return true;
    } catch {
      return false;
    }
  };
  assert({
    given:
      'the actual selected config and three malformed proof configurations',
    should: 'admit only the exact isolated suite and retained reporter',
    actual: [
      accepts(config),
      accepts({ ...config, testMatch: '**/*.e2e.ts' }),
      accepts({ ...config, outputDir: 'test-results' }),
      accepts({ ...config, reporter: [] }),
    ],
    expected: [true, false, false, false],
  });
});

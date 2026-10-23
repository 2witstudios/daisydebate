import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundMediaAdmissionSchema } from './round-media';
setupRitewayBun();

test('media admission accepts only secure credential-free websocket URLs', () => {
  const values = [
    'wss://localhost:13165',
    'wss://[::1]:443/rtc',
    'wss://media.example.test/rtc?region=local',
    'ws://media.example.test',
    'https://media.example.test',
    'wss://user:secret@media.example.test',
    'wss://@media.example.test',
    'wss://media.example.test\\@other.example.test',
    'wss://media.example.test:99999',
    'not a URL',
  ];
  assert({
    given:
      'secure endpoints, credentials, insecure schemes and malformed input',
    should:
      'validate totally without requiring an ambient URL constructor in portable source',
    actual: values.map(
      (value) => roundMediaAdmissionSchema.shape.url.safeParse(value).success,
    ),
    expected: [
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
  });
});

test('media grants publish each source at most once', () => {
  const grants = roundMediaAdmissionSchema.shape.grants;
  const withPublish = (publish: readonly string[]) => ({
    publish,
    subscribe: true,
    hidden: false,
    capture: false,
  });
  assert({
    given: 'distinct, empty and repeated publish sources',
    should: 'accept distinct sources and refuse a repeated one',
    actual: [
      ['camera', 'microphone'],
      [],
      ['camera', 'camera'],
      ['microphone', 'microphone'],
    ].map((publish) => grants.safeParse(withPublish(publish)).success),
    expected: [true, true, false, false],
  });
});

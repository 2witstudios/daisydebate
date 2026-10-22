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

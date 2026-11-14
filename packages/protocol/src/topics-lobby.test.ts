import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildLobbyHostTopic,
  buildLobbyTopic,
  buildOrganizationHostTopic,
  lobbyTopicCapability,
  parseTopic,
} from './topics';
import { isPayloadDeliverableOnTopic } from './realtime-payloads';

setupRitewayBun();

const id = 'a'.repeat(24);

describe('lobby and organization topics (TAB-5.15)', async () => {
  test('a lobby topic', async () => {
    assert({
      given: 'a built lobby topic',
      should: 'parse to its family and lobby',
      actual: parseTopic(buildLobbyTopic(id)),
      expected: { family: 'lobby', lobbyId: id },
    });
    assert({
      given: "a built lobby's host topic",
      should: 'parse to the host family and lobby',
      actual: parseTopic(buildLobbyHostTopic(id)),
      expected: { family: 'lobby:host', lobbyId: id },
    });
    assert({
      given: "a built organization's host topic",
      should: 'parse to its family and organization',
      actual: parseTopic(buildOrganizationHostTopic(id)),
      expected: { family: 'organization:host', organizationId: id },
    });
  });

  test('malformed topics', async () => {
    assert({
      given:
        'a lobby topic with a malformed id, an organization with no suffix, or another suffix',
      should: 'refuse each',
      actual: [
        parseTopic('lobby:not-an-id'),
        parseTopic(`organization:${id}`),
        parseTopic(`lobby:${id}:guests`),
      ],
      expected: [undefined, undefined, undefined],
    });
    let thrown = false;
    try {
      buildLobbyTopic('nope');
    } catch {
      thrown = true;
    }
    assert({
      given: 'a malformed id to a builder',
      should: 'throw rather than build a topic',
      actual: thrown,
      expected: true,
    });
  });

  test('doorbells', async () => {
    const bell = (kind: string) => ({ kind, entityVersion: 1, ids: [id] });
    assert({
      given:
        "each family's own doorbell, and a lobby doorbell on the host topic",
      should: 'deliver only its own kind',
      actual: [
        isPayloadDeliverableOnTopic(buildLobbyTopic(id), bell('lobby.changed')),
        isPayloadDeliverableOnTopic(
          buildLobbyHostTopic(id),
          bell('lobby.host-changed'),
        ),
        isPayloadDeliverableOnTopic(
          buildOrganizationHostTopic(id),
          bell('organization.host-changed'),
        ),
        isPayloadDeliverableOnTopic(
          buildLobbyHostTopic(id),
          bell('lobby.changed'),
        ),
      ],
      expected: [true, true, true, false],
    });
  });

  test('one subscribe capability per family', async () => {
    assert({
      given: 'each new family',
      should: 'map to the capability of the read it mirrors',
      actual: lobbyTopicCapability,
      expected: {
        lobby: 'lobby.read',
        'lobby:host': 'lobby.host.read',
        'organization:host': 'organization.host.read',
      },
    });
  });
});

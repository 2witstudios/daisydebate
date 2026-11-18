import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  lobbyPeopleReadCatalogue,
  lobbyPeopleViewSchema,
} from './lobby-people-read';
setupRitewayBun();
const id = (c: string) => c.repeat(24);
const view = {
  lobbyId: id('l'),
  version: 2,
  name: 'Open',
  roles: [],
  capabilities: { give: true },
  people: [
    {
      userId: id('u'),
      name: 'Owner',
      owner: true,
      grants: [],
      removable: false,
    },
  ],
};
test('lobby People retains its own scope, guard and immutable owner position', () => {
  assert({
    given:
      'a valid lobby view, an organization-shaped view and removable owner controls',
    should: 'accept only the exact lobby contract and protect its owner grants',
    actual: [
      lobbyPeopleViewSchema.safeParse(view).success,
      lobbyPeopleViewSchema.safeParse({ ...view, organizationId: id('o') })
        .success,
      lobbyPeopleViewSchema.safeParse({ ...view, version: 0 }).success,
      lobbyPeopleViewSchema.safeParse({
        ...view,
        people: [{ ...view.people[0], removable: true }],
      }).success,
      lobbyPeopleViewSchema.safeParse({
        ...view,
        people: [
          {
            ...view.people[0],
            grants: [
              {
                grantId: id('g'),
                roleId: id('r'),
                expiresAt: null,
                removable: true,
              },
            ],
          },
        ],
      }).success,
      lobbyPeopleReadCatalogue.LobbyPeopleView.gate,
    ],
    expected: [true, false, false, false, false, ['lobby.host.people.read']],
  });
});

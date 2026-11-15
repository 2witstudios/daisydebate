import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  initialPeopleCommand,
  peopleCommandFields,
  peopleCommandRefused,
} from '../../../features/tab/organization-people-forms';
import { PeopleCommandFields } from './people-command-fields';
setupRitewayBun();
const model = {
  kind: 'give',
  members: [{ value: 'member-id', label: 'Ada' }],
  roles: [{ value: 'role-id', label: 'Staff' }],
  scopes: [{ value: 'organization', label: 'Whole organization' }],
} as const;
const render = (pending = false, refused = false) =>
  renderToString(
    createElement(PeopleCommandFields, {
      model,
      pending,
      noticeId: 'role-answer',
      submit: () => {},
      fields: peopleCommandFields(
        refused
          ? peopleCommandRefused(
              {
                userId: 'member-id',
                roleId: 'role-id',
                scope: 'organization',
                expiresAt: '2027-01-02T12:30',
                grantId: '',
              },
              'People changed. Reload this page before trying again.',
            )
          : initialPeopleCommand(),
      ),
    }),
  );
test('the live disclosure asks for meaningful role choices and labels its expiry timezone', () => {
  const html = render();
  assert({
    given: 'the actual role-form presentation',
    should:
      'render named controls for member, preset role, scope and explicit UTC expiry with its real action',
    actual: [
      html.includes('name="userId"'),
      html.includes('name="roleId"'),
      html.includes('name="scope"'),
      html.includes('Expiry (UTC, optional)'),
      html.includes('type="datetime-local"'),
      html.includes('Give role'),
      html.includes('data-sample'),
    ],
    expected: [true, true, true, true, true, true, false],
  });
});
test('a refusal retains the selected person and role and gives the answer a focus target', () => {
  const html = render(false, true);
  assert({
    given: 'a stale-role refusal',
    should:
      'retain selected values and render the announced, focusable explanation',
    actual: [
      html.includes('value="member-id" selected=""'),
      html.includes('value="role-id" selected=""'),
      html.includes('value="2027-01-02T12:30"'),
      html.includes('role="alert"'),
      html.includes('id="role-answer" tabindex="-1"'),
      html.includes('People changed.'),
    ],
    expected: [true, true, true, true, true, true],
  });
});
test('a pending command disables the complete control set and hides its previous notice', () => {
  const html = render(true, true);
  assert({
    given: 'a role command in flight',
    should:
      'disable its controls together, label the pending button and omit stale error text',
    actual: [
      html.includes('<fieldset disabled=""'),
      html.includes('Saving…'),
      html.includes('People changed.'),
    ],
    expected: [true, true, false],
  });
});

test('a pending invitation has its own cancellation control', () => {
  const html = renderToString(
    createElement(PeopleCommandFields, {
      model: { kind: 'cancel', person: 'Ada' },
      pending: false,
      noticeId: 'cancel-answer',
      submit: () => {},
      fields: peopleCommandFields(initialPeopleCommand()),
    }),
  );
  assert({
    given: 'a real pending invitation',
    should: 'offer cancellation without role selectors or a sample link',
    actual: [
      html.includes('Cancel invite'),
      html.includes('name="grantId"'),
      html.includes('data-sample'),
      html.includes('Ada'),
    ],
    expected: [true, false, false, true],
  });
});

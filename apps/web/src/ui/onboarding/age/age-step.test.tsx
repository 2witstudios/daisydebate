import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { AgeRefusalStep } from './age-refusal';
import { YouthLanding } from './youth-landing';

setupRitewayBun();
await mockNextRouter();
const { AgeStep } = await import('./age-step');

type View = ReturnType<typeof renderAccessible>;

/** A select as its name, whether required, and its first choice: [value, label, selected]. */
const select = (view: View, label: string) => {
  const control = view.get('combobox', label);
  const first = view.within('combobox', label).all('option')[0];
  return [
    control.getAttribute('name'),
    control.hasAttribute('required'),
    [
      first?.getAttribute('value'),
      first?.textContent,
      first?.hasAttribute('selected'),
    ],
  ];
};

/** A form posts through a control; a page with none has nothing to post. */
const postable = (view: View) =>
  ['button', 'textbox', 'checkbox', 'combobox'].some(
    (role) => view.count(role) > 0,
  );

test('the age step asks month and year neutrally, with the Terms', () => {
  const view = renderAccessible(
    <AgeStep action={async (state) => state} years={[2026, 2025, 1990]} />,
  );
  const terms = /^I agree to the Terms and the Privacy notice/;
  assert({
    given: 'a new account at the age step',
    should:
      'offer required month and year selects with an empty first choice, a required Terms and Privacy checkbox, and no age cutoff',
    actual: [
      view.textContent().includes('When were you born?'),
      select(view, 'Month'),
      select(view, 'Year'),
      view.within('combobox', 'Month').attribute('option', 'December', 'value'),
      view.within('combobox', 'Year').attribute('option', '1990', 'value'),
      [
        view.attribute('checkbox', terms, 'name'),
        view.attribute('checkbox', terms, 'value'),
        view.get('checkbox', terms).hasAttribute('required'),
      ],
      [
        view.attribute('link', 'Terms', 'href'),
        view.attribute('link', 'Privacy notice', 'href'),
      ],
      /\b1[36]\b/.test(view.textContent()),
    ],
    expected: [
      true,
      ['month', true, ['', 'Month', true]],
      ['year', true, ['', 'Year', true]],
      '12',
      '1990',
      ['terms', 'accepted', true],
      ['/terms', '/privacy'],
      false,
    ],
  });
});

test('under 13, a neutral signed-out page keeps nothing', () => {
  const child = renderAccessible(<AgeRefusalStep refusal="under-13" />);
  assert({
    given: 'an under-13 answer',
    should:
      'say Daisy is for 13 and older, with nothing kept, no form and no other age named',
    actual: [
      child.textContent().includes('Daisy is for people 13 and older.'),
      child.textContent().includes('We haven’t kept anything you entered.'),
      postable(child),
      /\b16\b/.test(child.textContent()),
    ],
    expected: [true, true, false, false],
  });
});

test('a member aged 13 to 17 is told they are in the Youth lobby, then goes on', () => {
  const view = renderAccessible(
    <YouthLanding
      next="/onboarding/username?next=%2Flobby"
      lobbyName="Youth"
    />,
  );
  assert({
    given: 'the landing after the age step for a Youth member',
    should:
      'name the Youth lobby and link on to the username step without a form',
    actual: [
      view.has('heading', 'You’re in the Youth lobby'),
      view.textContent().includes('Thanks. Here’s where you’ll play.'),
      view.attribute('link', 'Continue', 'href'),
      view.textContent().includes('Next: choose your username.'),
      postable(view),
    ],
    expected: [true, true, '/onboarding/username?next=%2Flobby', true, false],
  });
});

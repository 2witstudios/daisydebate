import { Window } from 'happy-dom';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  dismissal,
  holdInert,
  openOnInvalid,
  releaseInert,
  returnTarget,
  setupOpener,
} from './room-setup-modal';

setupRitewayBun();

/** A room page: the header link, Edit on the resolution, Customize on the round summary, then the sheet. */
function roomPage() {
  const { document } = new Window();
  document.body.innerHTML = `
    <main id="room">
      <section id="resolution"><a id="edit" href="#room-setup">Edit</a></section>
      <header><a id="home" data-room-setup-home href="#room-setup">Room setup</a></header>
      <section id="summary"><a id="customize" href="#room-setup"><span id="label">Customize</span></a></section>
      <div id="sheet-host"><section id="room-setup" role="dialog"><form id="form"></form></section></div>
    </main>`;
  const byId = (id: string) =>
    document.getElementById(id) as unknown as HTMLElement;
  return { document: document as unknown as Document, byId };
}

test('focus returns to the link that opened the sheet', () => {
  const { document, byId } = roomPage();
  assert({
    given:
      'the sheet opened from Edit, from Customize (through its label), and from elsewhere',
    should:
      'return focus to Edit, to Customize, and to the header Room setup link',
    actual: [
      returnTarget(document, setupOpener(byId('edit')))?.id,
      returnTarget(document, setupOpener(byId('label')))?.id,
      returnTarget(document, setupOpener(byId('form')))?.id,
    ],
    expected: ['edit', 'customize', 'home'],
  });
});

test('an opener that left the page falls back to the header link', () => {
  const { document, byId } = roomPage();
  const edit = byId('edit');
  edit.remove();
  assert({
    given: 'the sheet opened from Edit, which room sync removed meanwhile',
    should: 'return focus to the header Room setup link',
    actual: returnTarget(document, edit)?.id,
    expected: 'home',
  });
});

test('content mounted behind the open sheet is inert until it closes', () => {
  const { document, byId } = roomPage();
  const held = new Set<HTMLElement>();
  const sheet = byId('room-setup');
  holdInert(sheet, held);
  const prep = document.createElement('section');
  byId('room').append(prep);
  const notice = document.createElement('p');
  byId('sheet-host').append(notice);
  holdInert(sheet, held);
  const opened = [prep.inert, notice.inert, byId('summary').inert, sheet.inert];
  releaseInert(held);
  assert({
    given: 'prep and a notice mounted beside the sheet after it opened',
    should:
      'make them inert with the rest of the page, never the sheet, and lift it on close',
    actual: [opened, [prep.inert, notice.inert, byId('summary').inert]],
    expected: [
      [true, true, true, false],
      [false, false, false],
    ],
  });
});

test('closing leaves alone what was inert before the sheet opened', () => {
  const { byId } = roomPage();
  const held = new Set<HTMLElement>();
  byId('summary').inert = true;
  holdInert(byId('room-setup'), held);
  releaseInert(held);
  assert({
    given: 'the round summary already inert for another reason',
    should: 'keep it inert after the sheet closes',
    actual: byId('summary').inert,
    expected: true,
  });
});

test('Escape and the close links drop the fragment unless a save was refused', () => {
  const { document, byId } = roomPage();
  const sheet = byId('room-setup');
  const before = dismissal(sheet);
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  byId('form').append(alert);
  assert({
    given: 'the open sheet, then the same sheet showing a refused save',
    should:
      'close by dropping the fragment, then navigate to the room so the refusal clears',
    actual: [before, dismissal(sheet)],
    expected: ['fragment', 'navigate'],
  });
});

test('an invalid value inside the collapsed rules opens the disclosure', () => {
  const { document } = new Window();
  document.body.innerHTML = `<form><details><summary>Customize speeches and rules</summary>
    <input id="speech" type="number" min="1" value="0"></details></form>`;
  const details = document.querySelector('details')!;
  details.addEventListener(
    'invalid',
    (event) =>
      openOnInvalid(event as unknown as { currentTarget: HTMLDetailsElement }),
    true,
  );
  const before = details.open;
  (
    document.getElementById('speech') as unknown as HTMLInputElement
  ).checkValidity();
  assert({
    given: 'the rules disclosure closed over an out-of-range speech time',
    should: 'open on the field’s invalid event',
    actual: [before, details.open],
    expected: [false, true],
  });
});

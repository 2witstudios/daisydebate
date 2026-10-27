import { Window } from 'happy-dom';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  dismissal,
  holdInert,
  modalSheet,
  ROOM_SETUP_HOME,
  ROOM_TITLE,
  type SheetWindow,
  openOnInvalid,
  releaseInert,
  returnTarget,
  setupOpener,
} from './room-setup-modal';

setupRitewayBun();

/** A room page: the header link, Edit on the resolution, Customize on the round summary, then the sheet. */
function roomPage() {
  const window = new Window({ url: 'https://daisy.test/rooms/r1' });
  const { document } = window;
  document.body.innerHTML = `
    <main id="room">
      <section id="resolution"><a id="edit" href="#room-setup">Edit</a></section>
      <header><h1 id="title" ${ROOM_TITLE} tabindex="-1">Room</h1><a id="home" ${ROOM_SETUP_HOME} href="#room-setup">Room setup</a></header>
      <section id="summary"><a id="customize" href="#room-setup"><span id="label">Customize</span></a></section>
      <div id="sheet-host"><section id="room-setup" role="dialog"><form id="form"></form></section></div>
    </main>`;
  const byId = (id: string) =>
    document.getElementById(id) as unknown as HTMLElement;
  return {
    happy: window,
    window: window as unknown as SheetWindow,
    document: document as unknown as Document,
    byId,
  };
}

/** Lets the MutationObserver deliver its records. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Opens the sheet by its fragment from the Edit link, as a click would. */
const openFrom = async (page: ReturnType<typeof roomPage>, id: string) => {
  const link = page.byId(id);
  link.focus();
  link.dispatchEvent(
    new page.happy.MouseEvent('click', { bubbles: true }) as unknown as Event,
  );
  page.happy.location.hash = '#room-setup';
  page.happy.dispatchEvent(new page.happy.Event('hashchange'));
  await settle();
};

const closeByFragment = async (page: ReturnType<typeof roomPage>) => {
  page.happy.location.hash = '';
  page.happy.dispatchEvent(new page.happy.Event('hashchange'));
  await settle();
};

const watch = (page: ReturnType<typeof roomPage>) =>
  modalSheet({
    window: page.window,
    sheet: page.byId('room-setup'),
    heading: () => page.byId('form'),
  });

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

test('the sheet’s own wiring keeps late body content inert and returns focus (ISSUE-670)', async () => {
  const page = roomPage();
  const stop = watch(page);
  await openFrom(page, 'edit');
  // Mounted on the body itself, outside the sheet's own subtree.
  const late = page.document.createElement('aside');
  page.document.body.append(late);
  await settle();
  const whileOpen = late.inert;
  await closeByFragment(page);
  const focused = page.document.activeElement?.id;
  stop();
  assert({
    given:
      'the sheet opened from Edit, then content appended to the body behind it, then the fragment cleared',
    should:
      'make that content inert while open, release it on close and return focus to Edit',
    actual: [whileOpen, late.inert, focused],
    expected: [true, false, 'edit'],
  });
});

test('a sheet removed while open lets go and focuses the Room title (ISSUE-671)', async () => {
  const page = roomPage();
  const stop = watch(page);
  await openFrom(page, 'edit');
  const heldBefore = page.byId('summary').inert;
  // The round started from another device: canEdit flips false and the sheet unmounts.
  page.byId('sheet-host').remove();
  stop();
  assert({
    given: 'the open sheet unmounting because the host can no longer edit',
    should: 'release inert and move focus to the Room title, never to body',
    actual: [
      heldBefore,
      page.byId('summary').inert,
      page.document.activeElement?.id,
    ],
    expected: [true, false, 'title'],
  });
});

test('held nodes that room sync replaced are dropped, and only a plain click opens (ISSUE-671)', async () => {
  const page = roomPage();
  const held = new Set<HTMLElement>();
  const sheet = page.byId('room-setup');
  holdInert(sheet, held);
  const replaced = page.byId('summary');
  replaced.remove();
  holdInert(sheet, held);
  const stillHeld = held.has(replaced);
  releaseInert(held);
  const stop = watch(page);
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { button: 1 }])
    page.byId('edit').dispatchEvent(
      new page.happy.MouseEvent('click', {
        bubbles: true,
        ...init,
      }) as unknown as Event,
    );
  // The sheet then opens from the address bar, with no link focused.
  page.happy.location.hash = '#room-setup';
  page.happy.dispatchEvent(new page.happy.Event('hashchange'));
  await settle();
  await closeByFragment(page);
  const focused = page.document.activeElement?.id;
  stop();
  assert({
    given:
      'a held summary that sync removed, then ctrl-, meta- and middle clicks on Edit that opened new tabs, then the sheet opened by its fragment',
    should:
      'stop holding the detached node, and return focus to the header link rather than to a click that never opened the sheet',
    actual: [stillHeld, focused],
    expected: [false, 'home'],
  });
});

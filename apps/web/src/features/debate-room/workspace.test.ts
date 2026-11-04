import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { phonePanels, sidebarTabs } from './workspace';

setupRitewayBun();

describe('the sidebars', () => {
  test('every Round offers the same tabs', () => {
    assert({
      given: 'the Round sidebar and a phone’s panels',
      should: 'list Transcript, Channels and AI chat, with no Round type input',
      actual: [sidebarTabs, phonePanels],
      expected: [
        ['transcript', 'channels', 'ai'],
        ['doc', 'transcript', 'channels', 'ai', 'files', 'room'],
      ],
    });
  });
});

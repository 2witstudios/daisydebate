import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import {
  DAISY_DEBATE_DRIVE_ID,
  DOCUMENTATION_AGENT_ID,
  DOCUMENTATION_FOLDER_ID,
  documentationLocation,
} from './pagespace-docs';

setupRitewayBun();

describe('documentationLocation', async () => {
  test('defaults to the Daisy Debate Documentation folder', async () => {
    const originalDrive = process.env.PAGESPACE_DOCUMENTATION_DRIVE_ID;
    const originalRoot = process.env.PAGESPACE_DOCUMENTATION_ROOT_PAGE_ID;
    const originalAgent = process.env.PAGESPACE_DOCUMENTATION_AGENT_PAGE_ID;
    delete process.env.PAGESPACE_DOCUMENTATION_DRIVE_ID;
    delete process.env.PAGESPACE_DOCUMENTATION_ROOT_PAGE_ID;
    delete process.env.PAGESPACE_DOCUMENTATION_AGENT_PAGE_ID;

    try {
      assert({
        given: 'no documentation location overrides',
        should: 'use the existing Daisy Debate drive and folder',
        actual: documentationLocation(),
        expected: {
          driveId: DAISY_DEBATE_DRIVE_ID,
          rootPageId: DOCUMENTATION_FOLDER_ID,
          agentPageId: DOCUMENTATION_AGENT_ID,
        },
      });
    } finally {
      if (originalDrive)
        process.env.PAGESPACE_DOCUMENTATION_DRIVE_ID = originalDrive;
      else delete process.env.PAGESPACE_DOCUMENTATION_DRIVE_ID;
      if (originalRoot)
        process.env.PAGESPACE_DOCUMENTATION_ROOT_PAGE_ID = originalRoot;
      else delete process.env.PAGESPACE_DOCUMENTATION_ROOT_PAGE_ID;
      if (originalAgent)
        process.env.PAGESPACE_DOCUMENTATION_AGENT_PAGE_ID = originalAgent;
      else delete process.env.PAGESPACE_DOCUMENTATION_AGENT_PAGE_ID;
    }
  });
});

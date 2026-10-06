import type { ChatMessage } from '../../features/debate-room/chat';
import type {
  Side,
  SpeechSlot,
  WorkspaceDocument,
} from '../../features/debate-room/documents';
import type { RoundPhase } from '../../features/debate-room/layout';
import type { TranscriptSegment } from '../../features/debate-room/transcript';
import type {
  Agent,
  Channel,
  RoundKind,
} from '../../features/debate-room/workspace';

export type Debater = {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly side: Side;
  readonly rating: number;
};

/** One line in an agent conversation; `edit` proposes a document change. */
export type AgentTurn = {
  readonly id: string;
  readonly from: 'you' | 'agent';
  readonly text: string;
  readonly edit?: {
    readonly documentId: string;
    readonly removed: readonly string[];
    readonly added: readonly string[];
  };
};

/** What the room renders: one debater's view of one round. */
export type RoundSnapshot = {
  readonly resolution: string;
  readonly kind: RoundKind;
  readonly phase: RoundPhase;
  readonly self: Debater;
  readonly opponent: Debater;
  readonly speeches: readonly SpeechSlot[];
  readonly liveIndex: number;
  readonly clock: { readonly label: string; readonly remainingMs: number };
  readonly prepMs: Readonly<Record<Side, number>>;
  readonly micLive: boolean;
  readonly clubName: string | null;
  readonly documents: readonly WorkspaceDocument[];
  readonly channels: readonly Channel[];
  readonly messages: readonly ChatMessage[];
  readonly agents: readonly Agent[];
  readonly agentThreads: Readonly<Record<string, readonly AgentTurn[]>>;
  readonly agentPrompts: Readonly<Record<string, readonly string[]>>;
  readonly transcript: readonly TranscriptSegment[];
};

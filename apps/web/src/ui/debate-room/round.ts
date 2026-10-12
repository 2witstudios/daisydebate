import type { CompetitionType } from '@daisy/protocol';
import type { ChatMessage } from '../../features/debate-room/chat';
import type {
  Side,
  SpeechSlot,
  WorkspaceDocument,
} from '../../features/debate-room/documents/documents';
import type { RoundPhase } from '../../features/debate-room/layout';
import type { TranscriptSegment } from '../../features/debate-room/transcript';
import type { Agent, Channel } from '../../features/debate-room/workspace';

export type Debater = {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly side: Side;
  /** Null when the room has no rating to show beside the name. */
  readonly rating: number | null;
};

/** Someone seated in the round, as the Room tab lists them. */
export type RoundPerson = {
  readonly id: string;
  readonly name: string;
  readonly role: Side | 'judge';
  readonly bot: boolean;
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
  readonly competition: CompetitionType;
  readonly phase: RoundPhase;
  readonly self: Debater;
  readonly opponent: Debater;
  /** Everyone seated; a human judge stays anonymous. */
  readonly people: readonly RoundPerson[];
  /** Who judges: a seated human, the AI judge, or nobody. */
  readonly judge: 'human' | 'ai' | null;
  /** Rating won and lost on this result, in a ranked round. */
  readonly stakes: { readonly win: number; readonly loss: number } | null;
  readonly recording: boolean;
  readonly transcribing: boolean;
  readonly speeches: readonly SpeechSlot[];
  readonly liveIndex: number;
  /** The main clock; null when the room cannot read the running round. */
  readonly clock: {
    readonly label: string;
    readonly remainingMs: number;
  } | null;
  /** Each side's prep left; null when the round has no in-round prep. */
  readonly prepMs: Readonly<Record<Side, number>> | null;
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

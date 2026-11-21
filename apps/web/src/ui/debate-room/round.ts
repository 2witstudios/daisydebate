import type { CompetitionType, SeatRef, SideKey } from '@daisy/protocol';
import type { ChatMessage } from '../../features/debate-room/chat';
import type { SideTone, SpeechSlot } from '../../features/debate-room/speeches';
import type { RoundWaitingOn } from '@daisy/protocol';
import type { JudgingBallots } from '../../features/debate-room/judging';
import type { RoundPhase } from '../../features/debate-room/layout';
import type { Agent, Channel } from '../../features/debate-room/workspace';

/** A competitor seat in the room: whose it is, and how its side reads. */
export type Debater = {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly seat: SeatRef;
  /** The seat's side; null for an unsided speaker. */
  readonly side: SideKey | null;
  /** "Affirmative", or "Speaker 2" for an unsided seat. */
  readonly sideLabel: string;
  /** "Aff", or the seat's own name for an unsided seat. */
  readonly sideShort: string;
  readonly tone: SideTone;
  /** Null when the room has no rating to show beside the name. */
  readonly rating: number | null;
};

/** One heading of the Room tab: a side, the speakers, the moderator or the judges. */
export type SeatGroup = {
  readonly key: string;
  readonly title: string;
  readonly judges: boolean;
};

/** Someone seated in the round, as the Room tab lists them. */
export type RoundPerson = {
  readonly id: string;
  readonly name: string;
  /** The `SeatGroup` this seat is listed under. */
  readonly group: string;
  readonly judge: boolean;
  readonly bot: boolean;
};

/** One side's in-round prep left. */
type SidePrep = {
  readonly side: SideKey;
  readonly label: string;
  readonly tone: SideTone;
  readonly remainingMs: number;
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
  readonly id: string;
  readonly resolution: string;
  readonly competition: CompetitionType;
  readonly phase: RoundPhase;
  readonly self: Debater;
  /** Every other competitor seat, in the format's seat order. */
  readonly others: readonly Debater[];
  /** The Room tab's headings, in seat order. */
  readonly groups: readonly SeatGroup[];
  /** Everyone seated; a human judge stays anonymous. */
  readonly people: readonly RoundPerson[];
  /** Who judges: a seated human, the AI judge, or nobody. */
  readonly judge: 'human' | 'ai' | null;
  /** The ballots the judging window waits on; null without a judge. */
  readonly ballots: JudgingBallots | null;
  /** What the server says the Round is waiting on. */
  readonly judgingState: RoundWaitingOn['state'] | null;
  /** Rating won and lost on this result, in a ranked round. */
  readonly stakes: { readonly win: number; readonly loss: number } | null;
  readonly speeches: readonly SpeechSlot[];
  readonly liveIndex: number;
  /** The main clock; null when the room cannot read the running round. */
  readonly clock: {
    readonly label: string;
    readonly remainingMs: number;
    /** Something the seat should know while this clock runs. */
    readonly note?: string;
  } | null;
  /** Each side's prep left, in declared order; null when the round has no in-round prep. */
  readonly prep: readonly SidePrep[] | null;
  readonly micLive: boolean;
  readonly channels: readonly Channel[];
  readonly messages: readonly ChatMessage[];
  readonly agents: readonly Agent[];
  readonly agentThreads: Readonly<Record<string, readonly AgentTurn[]>>;
  readonly agentPrompts: Readonly<Record<string, readonly string[]>>;
};

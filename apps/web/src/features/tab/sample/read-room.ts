import {
  sampleEventRoom,
  sampleLiveSection,
  sampleStandingRoom,
} from './rooms';
import type { SampleScene } from './scene';
import { sampleAddressOf } from './tournament';
import { type WaitingRoom, type LiveSection, waitingRoomOf } from '../room';

export const readRoom = (
  id: string,
  scene: SampleScene,
): WaitingRoom | null => {
  const room = sampleEventRoom(id, scene);
  return room === null
    ? sampleStandingRoom(id, scene)
    : waitingRoomOf(room, sampleAddressOf);
};

export const readLiveSection = (
  id: string,
  scene: SampleScene,
): LiveSection | null => sampleLiveSection(id, scene);

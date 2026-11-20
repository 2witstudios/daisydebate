/** A sample's stable identifier, shaped as a real one: 24 of `[a-z0-9]`. */
export const sampleId = (name: string): string =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

/** The instant every host sample reads as now: the day of Autumn Open. */
export const sampleNow = '2026-11-14T21:00:00.000Z';

export const sampleIds = {
  league: sampleId('league'),
  leagueLobby: sampleId('leaguelobby'),
  autumn: sampleId('autumnopen'),
  winter: sampleId('winterclassic'),
  scrimmage: sampleId('fridayscrimmage'),
  opener: sampleId('septemberopener'),
  ridgeview: sampleId('ridgeviewinvitational'),
  championship: sampleId('championship'),
  ridgeviewSchool: sampleId('ridgeviewschool'),
  hartwell: sampleId('hartwellschool'),
  varsityTemplate: sampleId('varsitytemplate'),
} as const;

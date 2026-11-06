import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatDate,
  formatMonth,
  formatRuntime,
  formatScore,
  formatScoreShort,
  groupCredits,
  initialsOf,
  inSentence,
  languageName,
  libraryStatusLabel,
  regionName,
  relationLabel,
  statusLabel,
  unitLabel,
} from '@/lib/format';

describe('numbers', () => {
  it('shortens big counts', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(10_000)).toBe('10K');
    expect(formatCount(12_345)).toBe('12.3K');
    expect(formatCount(1_900_000)).toBe('1.9M');
  });

  it('shows scores with up to two decimals', () => {
    expect(formatScore(9)).toBe('9');
    expect(formatScore(7.9)).toBe('7.9');
    expect(formatScore(8.754)).toBe('8.75');
    expect(formatScoreShort(7.84)).toBe('7.8');
    expect(formatScoreShort(9)).toBe('9.0');
  });

  it('writes runtimes in hours and minutes', () => {
    expect(formatRuntime(45)).toBe('45 min');
    expect(formatRuntime(60)).toBe('1 h');
    expect(formatRuntime(116)).toBe('1 h 56 min');
    expect(formatRuntime(180)).toBe('3 h');
  });
});

describe('dates', () => {
  it('formats calendar dates without drifting across time zones', () => {
    expect(formatDate('1998-04-03')).toBe('3 Apr 1998');
    expect(formatDate('2020-12-31')).toBe('31 Dec 2020');
    expect(formatDate('2021-01-01T00:30:00+05:30')).toBe('1 Jan 2021');
  });

  it('copes with missing and unreadable dates', () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate(undefined)).toBeNull();
    expect(formatDate('')).toBeNull();
    expect(formatDate('sometime')).toBe('sometime');
    expect(formatMonth('2026-11-03T10:00:00Z')).toBe('November 2026');
  });
});

describe('labels', () => {
  it('lowercases a label inside a sentence, except for acronyms', () => {
    expect(inSentence('Anime')).toBe('anime');
    expect(inSentence('Novels')).toBe('novels');
    expect(inSentence('TV')).toBe('TV');
    expect(inSentence('TV series')).toBe('TV series');
    expect(inSentence('Movie')).toBe('movie');
    expect(inSentence('')).toBe('');
  });

  it('names statuses, with a safe fallback', () => {
    expect(statusLabel('releasing')).toBe('Releasing');
    expect(statusLabel('hiatus')).toBe('On hiatus');
    expect(statusLabel('something_new')).toBe('Status unknown');
  });

  it('names relations', () => {
    expect(relationLabel('sequel')).toBe('Sequel');
    expect(relationLabel('spin_off')).toBe('Spin-off');
    expect(relationLabel('adapted_from')).toBe('Adapted from');
    expect(relationLabel('alternative_setting')).toBe('Alternative setting');
  });

  it('uses the singular for one', () => {
    expect(unitLabel('episodes', 1)).toBe('episode');
    expect(unitLabel('episodes', 12)).toBe('episodes');
    expect(unitLabel('chapters', 0)).toBe('chapters');
    expect(unitLabel('viewing', 3)).toBe('');
    expect(unitLabel(null, 3)).toBe('');
  });

  it('says watching or reading to suit the medium', () => {
    expect(libraryStatusLabel('in_progress', 'anime')).toBe('Watching');
    expect(libraryStatusLabel('in_progress', 'movie')).toBe('Watching');
    expect(libraryStatusLabel('in_progress', 'manga')).toBe('Reading');
    expect(libraryStatusLabel('planned', 'book')).toBe('Plan to read');
    expect(libraryStatusLabel('repeating', 'tv')).toBe('Rewatching');
    expect(libraryStatusLabel('repeating', 'novel')).toBe('Rereading');
    expect(libraryStatusLabel('in_progress')).toBe('In progress');
    expect(libraryStatusLabel('completed', 'anime')).toBe('Completed');
    expect(libraryStatusLabel('paused')).toBe('On hold');
    expect(libraryStatusLabel('unheard_of')).toBe('unheard_of');
  });

  it('names countries and languages, and shows an unreadable code as it is', () => {
    expect(regionName('JP')).toBe('Japan');
    expect(regionName('jp')).toBe('Japan');
    expect(languageName('ja')).toBe('Japanese');
    expect(languageName('en')).toBe('English');
    expect(regionName('!!')).toBe('!!');
    expect(languageName('???')).toBe('???');
  });
});

describe('groupCredits', () => {
  it('groups by role in the order roles first appear', () => {
    const credits = [
      { role: 'Studio', name: 'A' },
      { role: 'Producer', name: 'B' },
      { role: 'Studio', name: 'C' },
    ];
    expect(groupCredits(credits)).toEqual([
      { role: 'Studio', items: [credits[0], credits[2]] },
      { role: 'Producer', items: [credits[1]] },
    ]);
    expect(groupCredits([])).toEqual([]);
  });
});

describe('initialsOf', () => {
  it('takes the first letters of the first two words', () => {
    expect(initialsOf('One Piece')).toBe('OP');
    expect(initialsOf('berserk')).toBe('B');
    expect(initialsOf('The Lord of the Rings')).toBe('TL');
    expect(initialsOf("Frieren: Beyond Journey's End")).toBe('FB');
  });

  it('handles titles with no letters, and other scripts', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('!!!')).toBe('?');
    expect(initialsOf('進撃の巨人')).toBe('進');
  });

  it('does not cut a character outside the Basic Multilingual Plane in half', () => {
    expect(initialsOf('𠮷野家')).toBe('𠮷');
  });
});

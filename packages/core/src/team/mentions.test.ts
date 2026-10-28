import { describe, expect, it } from 'vitest';

import { findMentions } from './notes';

const people = [
  { id: 'a', name: 'Sam' },
  { id: 'b', name: 'Sam Lee' },
  { id: 'c', name: 'Bea (Shop)' },
  { id: 'd', name: 'Zoë' },
];

describe('findMentions', () => {
  it('reads full names after @, the longest first', () => {
    expect(findMentions('@Sam Lee can you check?', people, 'x').map((p) => p.id)).toEqual(['b']);
    expect(
      findMentions('@sam and @SAM LEE', people, 'x')
        .map((p) => p.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('needs the whole name, and takes names with odd characters as written', () => {
    expect(findMentions('@Samuel please', people, 'x')).toEqual([]);
    expect(findMentions('thanks @Bea (Shop)!', people, 'x').map((p) => p.id)).toEqual(['c']);
    expect(findMentions('@Zoë ok', people, 'x').map((p) => p.id)).toEqual(['d']);
    expect(findMentions('sam@example.com', people, 'x')).toEqual([]);
    expect(findMentions('no mentions here', people, 'x')).toEqual([]);
  });

  it('never mentions the author', () => {
    expect(findMentions('note to self @Sam', people, 'a')).toEqual([]);
  });
});

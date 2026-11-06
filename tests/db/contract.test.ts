/**
 * Contract tests: every database function the site calls is run as a signed-out
 * visitor and as a signed-in member, through the site's own API wrappers, so the
 * answer has to pass the same schema the pages use. This catches a function that
 * is right for members but returns null where a page expects a boolean for visitors.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../e2e/mock-supabase/seed';
import { getAttributions, getCatalogStats, getFacets, getSimilarTitles, getTitle, searchTitles, suggestTitles } from '@/lib/api/catalog';
import { ApiError } from '@/lib/api/errors';
import { getLibraryEntry, listLibrary, removeLibraryEntry, saveLibraryEntry } from '@/lib/api/library';
import { deleteMyAccount, exportMyData, getProfile, isUsernameAvailable, updateMyProfile } from '@/lib/api/profile';
import { SORTS } from '@/lib/browse-params';
import { as, createTestDb, createUser, rpc } from '../helpers/db';

type Actor = Parameters<typeof as>[1];

/** Just enough of a Supabase client: `.rpc()` run the way PostgREST runs it, errors shaped like PostgREST's. */
function clientFor(db: PGlite, actor: Actor): SupabaseClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      try {
        const data = await as(db, actor, () => rpc(db, fn, args));
        // A function that returns void has an empty body over HTTP, which the client reads as null (PGlite gives '').
        return { data: data === '' ? null : data, error: null };
      } catch (error) {
        const failure = error as { message?: string; code?: string };
        return { data: null, error: { message: failure.message ?? 'failed', code: failure.code } };
      }
    },
  } as unknown as SupabaseClient;
}

let db: PGlite;
let visitor: SupabaseClient;
let alice: SupabaseClient;
let bob: SupabaseClient;
let aliceId: string;
let bobId: string;
let bebopId: string;
let bebopSlug: string;

beforeAll(async () => {
  db = await createTestDb();
  await seed(db);
  aliceId = await createUser(db, 'alice@example.test', 'alice_01');
  bobId = await createUser(db, 'bob@example.test', 'bob_02');
  visitor = clientFor(db, { role: 'anon' });
  alice = clientFor(db, { role: 'authenticated', userId: aliceId });
  bob = clientFor(db, { role: 'authenticated', userId: bobId });

  const found = await searchTitles(visitor, { q: 'Cowboy Bebop', sort: 'relevance', limit: 1, offset: 0 });
  bebopId = found.items[0]!.id;
  bebopSlug = found.items[0]!.slug;
});
afterAll(async () => {
  await db.close();
});

describe('as a signed-out visitor', () => {
  it('browses the catalog in every sort order and with every filter', async () => {
    for (const sort of SORTS) {
      const page = await searchTitles(visitor, { sort, limit: 5, offset: 0 });
      expect(page.items.length).toBeGreaterThan(0);
    }
    const filtered = await searchTitles(visitor, {
      q: 'bebop',
      mediaTypes: ['anime', 'manga'],
      genres: ['Action'],
      statuses: ['finished'],
      yearFrom: 1990,
      yearTo: 2010,
      minScore: 5,
      sort: 'score',
      limit: 10,
      offset: 0,
    });
    expect(filtered.total).toBeGreaterThanOrEqual(0);
    expect((await getFacets(visitor)).total).toBeGreaterThan(40);
    expect((await getFacets(visitor, ['movie'])).total).toBe(1);
    expect((await suggestTitles(visitor, 'cowb')).length).toBeGreaterThan(0);
    expect((await getCatalogStats(visitor)).total).toBeGreaterThan(40);
    expect((await getAttributions(visitor)).length).toBeGreaterThan(0);
  });

  it('opens a title with its credits, sources, relations and community score', async () => {
    const detail = await getTitle(visitor, bebopSlug);
    expect(detail?.contributors.length).toBeGreaterThan(0);
    expect(detail?.sources.length).toBeGreaterThan(0);
    expect(detail?.relations.length).toBeGreaterThan(0);
    expect(detail?.community).toMatchObject({ count: 0, average: null });
    expect(await getTitle(visitor, 'no-such-title')).toBeNull();
    expect((await getSimilarTitles(visitor, bebopId)).length).toBeGreaterThan(0);
  });

  it('sees a public profile as somebody else, never as their own, and nothing of a private one', async () => {
    const profile = await getProfile(visitor, 'alice_01');
    expect(profile).toMatchObject({ username: 'alice_01', is_self: false, is_public: true }); // the regression: is_self was null here
    expect(await getProfile(visitor)).toBeNull(); // "my profile" means nothing without an account

    await updateMyProfile(bob, { isPublic: false });
    expect(await getProfile(visitor, 'bob_02')).toBeNull();
    expect(await getProfile(alice, 'bob_02')).toBeNull();
    expect(await getProfile(bob, 'bob_02')).toMatchObject({ is_self: true, is_public: false });
    await updateMyProfile(bob, { isPublic: true });
  });

  it('reads libraries without notes, and has no library of its own', async () => {
    await saveLibraryEntry(alice, { titleId: bebopId, status: 'completed', rating: 9, notes: 'for my eyes only' });
    const library = await listLibrary(visitor, { userId: aliceId });
    expect(library.items).toHaveLength(1);
    expect(library.items[0]!.entry).not.toHaveProperty('notes');
    expect(await getLibraryEntry(visitor, bebopId)).toBeNull();
    expect((await listLibrary(visitor)).total).toBe(0);
    await removeLibraryEntry(alice, bebopId);
  });

  it('is turned away from everything that needs an account', async () => {
    const notSignedIn = expect.objectContaining({ code: 'not_authenticated' });
    await expect(saveLibraryEntry(visitor, { titleId: bebopId, status: 'planned' })).rejects.toEqual(notSignedIn);
    await expect(removeLibraryEntry(visitor, bebopId)).rejects.toEqual(notSignedIn);
    await expect(updateMyProfile(visitor, { bio: 'x' })).rejects.toEqual(notSignedIn);
    await expect(exportMyData(visitor)).rejects.toEqual(notSignedIn);
    await expect(deleteMyAccount(visitor)).rejects.toEqual(notSignedIn);
    await expect(deleteMyAccount(visitor)).rejects.toBeInstanceOf(ApiError);
  });

  it('can ask whether a username is free', async () => {
    expect(await isUsernameAvailable(visitor, 'ALICE_01')).toBe(false);
    expect(await isUsernameAvailable(visitor, 'brand_new')).toBe(true);
  });
});

describe('as a signed-in member', () => {
  it('keeps a library entry and sees it as their own', async () => {
    const saved = await saveLibraryEntry(alice, { titleId: bebopId, status: 'in_progress', progress: 3, rating: 8, notes: 'mine', isPrivate: true });
    expect(saved).toMatchObject({ status: 'in_progress', progress: 3, rating: 8, notes: 'mine', is_private: true });
    expect(await getLibraryEntry(alice, bebopId)).toMatchObject({ notes: 'mine' });
    const mine = await listLibrary(alice);
    expect(mine.items[0]!.entry).toMatchObject({ notes: 'mine' });
    expect(await getLibraryEntry(bob, bebopId)).toBeNull();
    expect((await getTitle(bob, bebopSlug))?.community).toMatchObject({ count: 1, average: 8 });
    expect(await removeLibraryEntry(alice, bebopId)).toBe(true);
    expect(await removeLibraryEntry(alice, bebopId)).toBe(false);
  });

  it('reads their own profile as theirs and other profiles as someone else’s', async () => {
    expect(await getProfile(alice)).toMatchObject({ username: 'alice_01', is_self: true });
    expect(await getProfile(alice, 'bob_02')).toMatchObject({ username: 'bob_02', is_self: false });
  });

  it('exports their data and deletes their account', async () => {
    await saveLibraryEntry(bob, { titleId: bebopId, status: 'planned', notes: 'exported' });
    const exported = await exportMyData(bob);
    expect(exported).toHaveProperty('profile');
    expect(JSON.stringify(exported)).toContain('exported');
    await deleteMyAccount(bob);
    expect(await getProfile(visitor, 'bob_02')).toBeNull();
    expect((await listLibrary(visitor, { userId: bobId })).total).toBe(0);
  });
});

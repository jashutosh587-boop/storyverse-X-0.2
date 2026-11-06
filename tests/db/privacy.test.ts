import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, createUser, rpc, seedTitle } from '../helpers/db';

interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  is_public: boolean;
  is_self: boolean;
}
interface Library {
  total: number;
  counts: Record<string, number>;
  items: { entry: { status: string; notes?: string | null }; title: { slug: string } }[];
}

let db: PGlite;
let alice: string;
let bob: string;
let titleA: string;
let titleB: string;

const asUser = <T>(userId: string, fn: () => Promise<T>) => as(db, { role: 'authenticated', userId }, fn);
const asAnon = <T>(fn: () => Promise<T>) => as(db, { role: 'anon' }, fn);
/** A reader who is not the owner: a visitor who is not signed in, or another member (bob). */
const viewing = <T>(who: 'visitor' | 'member', fn: () => Promise<T>) => (who === 'visitor' ? asAnon(fn) : asUser(bob, fn));

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.test', 'alice_01');
  bob = await createUser(db, 'bob@example.test', 'Alice_01'); // same name, different case
  titleA = await seedTitle(db, { slug: 'privacy-a', title: 'Privacy A', episodes: 12 });
  titleB = await seedTitle(db, { slug: 'privacy-b', title: 'Privacy B', episodes: 24 });
});
afterAll(async () => {
  await db.close();
});

describe('profiles', () => {
  it('uses the signup username when valid and free, otherwise generates one', async () => {
    const carol = await createUser(db, 'carol@example.test', 'x'); // too short
    const profiles = await db.query<{ id: string; username: string }>(`select id, username from public.profiles`);
    const byId = new Map(profiles.rows.map((p) => [p.id, p.username]));
    expect(byId.get(alice)).toBe('alice_01');
    expect(byId.get(bob)).toMatch(/^user_[0-9a-f]{12}$/); // 'Alice_01' collides case-insensitively
    expect(byId.get(carol)).toMatch(/^user_[0-9a-f]{12}$/);
  });

  it('answers username_available case-insensitively and rejects bad formats', async () => {
    expect(await asAnon(() => rpc<boolean>(db, 'username_available', { p_username: 'ALICE_01' }))).toBe(false);
    expect(await asAnon(() => rpc<boolean>(db, 'username_available', { p_username: 'free_name' }))).toBe(true);
    expect(await asAnon(() => rpc<boolean>(db, 'username_available', { p_username: 'no spaces' }))).toBe(false);
    expect(await asAnon(() => rpc<boolean>(db, 'username_available', { p_username: 'ab' }))).toBe(false);
  });

  it('lets a user edit their profile through update_my_profile, with validation', async () => {
    const updated = await asUser(bob, () =>
      rpc<Profile>(db, 'update_my_profile', { p_username: 'bobby_b', p_display_name: '  Bob  ', p_bio: 'Reads a lot' }),
    );
    expect(updated.username).toBe('bobby_b');
    expect(updated.display_name).toBe('Bob');
    expect(updated.is_self).toBe(true);

    await expect(
      asUser(bob, () => rpc(db, 'update_my_profile', { p_username: 'bad name!' })),
    ).rejects.toThrow(/invalid_username/);
    await expect(
      asUser(bob, () => rpc(db, 'update_my_profile', { p_username: 'ALICE_01' })),
    ).rejects.toThrow(/username_taken/);
    await expect(asAnon(() => rpc(db, 'update_my_profile', { p_bio: 'x' }))).rejects.toThrow(/permission denied/i);

    // an empty string clears an optional field; null leaves it alone
    const cleared = await asUser(bob, () => rpc<Profile>(db, 'update_my_profile', { p_bio: '' }));
    expect(cleared.bio).toBeNull();
    expect(cleared.display_name).toBe('Bob');
  });

  it("does not let one user change another's profile or protected columns", async () => {
    const res = await asUser(bob, () => db.query(`update public.profiles set bio = 'pwned' where id = $1`, [alice]));
    expect(res.affectedRows).toBe(0);
    await expect(
      asUser(bob, () => db.query(`update public.profiles set id = gen_random_uuid() where id = $1`, [bob])),
    ).rejects.toThrow(/permission denied/i);
    await expect(asUser(bob, () => db.query(`insert into public.profiles (id, username) values (gen_random_uuid(), 'sneaky')`))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('does not let a member write an avatar address, which nothing in the app sets yet', async () => {
    await expect(
      asUser(bob, () => db.query(`update public.profiles set avatar_url = 'https://example.test/me.png' where id = $1`, [bob])),
    ).rejects.toThrow(/permission denied/i);
  });

  it('still creates the profile when the wanted username is taken at the last moment', async () => {
    // Two people can pick the same name within the same instant, and the form's check cannot see the other one yet.
    // Simulated with a trigger that gives the name to someone else just before the new profile is written, so the
    // insert hits the unique index. (Postgres undoes that trigger's change together with the failed insert, so the
    // other person's name is not checked afterwards; what matters is that signing up still works.)
    const holder = await createUser(db, 'holder@example.test', 'holder_01');
    await db.exec(`
      create function public.test_steal_name() returns trigger language plpgsql as $$
      begin
        update public.profiles set username = new.username where id = '${holder}' and new.username = 'race_name';
        return new;
      end $$;
      create trigger test_steal_name before insert on public.profiles for each row execute function public.test_steal_name();
    `);
    try {
      const racer = await createUser(db, 'racer@example.test', 'race_name');
      const mine = await db.query<{ username: string }>(`select username from public.profiles where id = $1`, [racer]);
      expect(mine.rows[0]!.username).toMatch(/^user_[0-9a-f]{12}$/);
    } finally {
      await db.exec(`drop trigger test_steal_name on public.profiles; drop function public.test_steal_name();`);
    }
  });

  it('hides a private profile from everyone except its owner', async () => {
    await asUser(alice, () => rpc(db, 'update_my_profile', { p_is_public: false }));
    expect(await asAnon(() => rpc<Profile | null>(db, 'get_profile', { p_username: 'alice_01' }))).toBeNull();
    expect(await asUser(bob, () => rpc<Profile | null>(db, 'get_profile', { p_username: 'alice_01' }))).toBeNull();
    const own = await asUser(alice, () => rpc<Profile | null>(db, 'get_profile', { p_username: 'alice_01' }));
    expect(own?.is_self).toBe(true);
    await asUser(alice, () => rpc(db, 'update_my_profile', { p_is_public: true }));
    expect(await asAnon(() => rpc<Profile | null>(db, 'get_profile', { p_username: 'alice_01' }))).not.toBeNull();
  });
});

describe('library privacy', () => {
  beforeAll(async () => {
    await asUser(alice, () =>
      rpc(db, 'upsert_library_entry', { p_title_id: titleA, p_status: 'completed', p_rating: 9, p_notes: 'my secret thoughts' }),
    );
    await asUser(alice, () =>
      rpc(db, 'upsert_library_entry', { p_title_id: titleB, p_status: 'in_progress', p_progress: 3, p_is_private: true }),
    );
  });

  it('shows the owner everything, including notes', async () => {
    const lib = await asUser(alice, () => rpc<Library>(db, 'list_library', {}));
    expect(lib.items.map((i) => i.title.slug).sort()).toEqual(['privacy-a', 'privacy-b']);
    expect(lib.items.find((i) => i.title.slug === 'privacy-a')?.entry.notes).toBe('my secret thoughts');
  });

  it('shows others only public entries, never notes', async () => {
    for (const run of [
      () => asAnon(() => rpc<Library>(db, 'list_library', { p_user_id: alice })),
      () => asUser(bob, () => rpc<Library>(db, 'list_library', { p_user_id: alice })),
    ]) {
      const lib = await run();
      expect(lib.items.map((i) => i.title.slug)).toEqual(['privacy-a']);
      expect(lib.items[0]!.entry).not.toHaveProperty('notes');
      expect(lib.counts).toEqual({ completed: 1 }); // the private in-progress entry is not counted either
    }
  });

  it('keeps notes out of every table a reader can query', async () => {
    // The functions above leave notes out. Someone holding the project's anon key could skip the functions and query the tables, so the tables must not hold them either.
    for (const who of ['visitor', 'member'] as const) {
      // library_entries is readable for the entries of a public profile, so notes cannot be a column of it
      await expect(viewing(who, () => db.query(`select notes from public.library_entries`))).rejects.toThrow(/column "notes" does not exist/i);
      const rows = await viewing(who, () => db.query(`select * from public.library_entries where user_id = $1`, [alice]));
      expect(rows.rows.length).toBeGreaterThan(0); // alice's public entry is visible...
      for (const row of rows.rows) expect(Object.keys(row as object)).not.toContain('notes'); // ...without notes
    }
    // the notes table is closed to a visitor who is not signed in, and shows another member nothing
    await expect(asAnon(() => db.query(`select * from public.library_notes`))).rejects.toThrow(/permission denied/i);
    const seenByBob = await asUser(bob, () => db.query(`select * from public.library_notes`));
    expect(seenByBob.rows).toEqual([]);
    // the owner reads their own
    const mine = await asUser(alice, () => db.query<{ notes: string }>(`select notes from public.library_notes`));
    expect(mine.rows).toEqual([{ notes: 'my secret thoughts' }]);
  });

  it("refuses writes to someone else's notes", async () => {
    await expect(
      asUser(bob, () => db.query(`insert into public.library_notes (user_id, title_id, notes) values ($1, $2, 'planted')`, [alice, titleA])),
    ).rejects.toThrow(/row-level security/i);
    const update = await asUser(bob, () => db.query(`update public.library_notes set notes = 'planted' where user_id = $1`, [alice]));
    expect(update.affectedRows).toBe(0);
    const del = await asUser(bob, () => db.query(`delete from public.library_notes where user_id = $1`, [alice]));
    expect(del.affectedRows).toBe(0);
    await expect(
      asAnon(() => db.query(`insert into public.library_notes (user_id, title_id, notes) values ($1, $2, 'planted')`, [alice, titleA])),
    ).rejects.toThrow(/permission denied/i);
    const mine = await asUser(alice, () => db.query<{ notes: string }>(`select notes from public.library_notes`));
    expect(mine.rows).toEqual([{ notes: 'my secret thoughts' }]);
  });

  it('hides the whole library when the profile is private', async () => {
    await asUser(alice, () => rpc(db, 'update_my_profile', { p_is_public: false }));
    const seenByBob = await asUser(bob, () => rpc<Library>(db, 'list_library', { p_user_id: alice }));
    expect(seenByBob.items).toEqual([]);
    const own = await asUser(alice, () => rpc<Library>(db, 'list_library', {}));
    expect(own.items).toHaveLength(2);
    await asUser(alice, () => rpc(db, 'update_my_profile', { p_is_public: true }));
  });

  it("blocks writes to someone else's entries", async () => {
    const update = await asUser(bob, () =>
      db.query(`update public.library_entries set rating = 1 where user_id = $1`, [alice]),
    );
    expect(update.affectedRows).toBe(0);
    const del = await asUser(bob, () => db.query(`delete from public.library_entries where user_id = $1`, [alice]));
    expect(del.affectedRows).toBe(0);
    await expect(
      asUser(bob, () =>
        db.query(`insert into public.library_entries (user_id, title_id, status) values ($1, $2, 'planned')`, [alice, titleA]),
      ),
    ).rejects.toThrow(/row-level security/i);
    const still = await db.query<{ rating: number }>(
      `select rating from public.library_entries where user_id = $1 and title_id = $2`,
      [alice, titleA],
    );
    expect(still.rows[0]!.rating).toBe(9);
  });

  it('refuses library writes from anonymous visitors', async () => {
    await expect(
      asAnon(() => rpc(db, 'upsert_library_entry', { p_title_id: titleA, p_status: 'planned' })),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAnon(() => db.query(`insert into public.library_entries (user_id, title_id, status) values ($1, $2, 'planned')`, [alice, titleA])),
    ).rejects.toThrow(/permission denied/i);
  });

  it('exports only the caller\'s own data', async () => {
    const mine = await asUser(alice, () => rpc<{ profile: Profile; library: { title_slug: string }[] }>(db, 'export_my_data', {}));
    expect(mine.profile.username).toBe('alice_01');
    expect(mine.library.map((l) => l.title_slug).sort()).toEqual(['privacy-a', 'privacy-b']);
    await expect(asAnon(() => rpc(db, 'export_my_data', {}))).rejects.toThrow(/permission denied/i);
  });

  it('removes a user\'s profile and library when the account is deleted', async () => {
    const dave = await createUser(db, 'dave@example.test', 'dave_01');
    await asUser(dave, () => rpc(db, 'upsert_library_entry', { p_title_id: titleA, p_status: 'planned' }));
    await db.query(`delete from auth.users where id = $1`, [dave]);
    const profiles = await db.query(`select 1 from public.profiles where id = $1`, [dave]);
    const entries = await db.query(`select 1 from public.library_entries where user_id = $1`, [dave]);
    expect(profiles.rows).toHaveLength(0);
    expect(entries.rows).toHaveLength(0);
  });
});

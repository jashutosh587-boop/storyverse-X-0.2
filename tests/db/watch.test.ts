import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, createUser, rpc, seedTitle } from '../helpers/db';

type WatchCatalog = {
  providers: { provider_name: string; country_code: string }[];
  episodes: {
    id: string;
    episode_number: number;
    position_seconds: number;
    duration_seconds: number | null;
    completed: boolean;
  }[];
};

let db: PGlite;
let alice: string;
let bob: string;
let titleId: string;
let episodeId: string;

const asAlice = <T>(fn: () => Promise<T>) => as(db, { role: 'authenticated', userId: alice }, fn);
const asBob = <T>(fn: () => Promise<T>) => as(db, { role: 'authenticated', userId: bob }, fn);
const asAnon = <T>(fn: () => Promise<T>) => as(db, { role: 'anon' }, fn);

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'watch-alice@example.test', 'watch_alice');
  bob = await createUser(db, 'watch-bob@example.test', 'watch_bob');
  titleId = await seedTitle(db, { slug: 'watch-test-anime', title: 'Watch Test Anime', episodes: 2 });
  const provider = await db.query<{ id: string }>(`
    insert into public.title_watch_links
      (title_id, provider_name, url, country_code, availability, is_official, is_active, verified_at)
    values ($1, 'Official Stream', 'https://stream.example/anime', 'IN', 'subscription', true, true, now())
    returning id
  `, [titleId]);
  expect(provider.rows).toHaveLength(1);
  const episode = await db.query<{ id: string }>(`
    insert into public.title_episodes
      (title_id, season_number, episode_number, episode_title, runtime_seconds, stream_url, stream_type,
       rights_holder, license_confirmed, license_confirmed_at, is_published)
    values ($1, 1, 1, 'The First Test', 120, 'https://cdn.example/episode-1.mp4', 'mp4',
       'Test rights holder', true, now(), true)
    returning id
  `, [titleId]);
  episodeId = episode.rows[0]!.id;
  await db.query(`
    insert into public.title_episodes (title_id, season_number, episode_number, episode_title, is_published, license_confirmed)
    values ($1, 1, 2, 'Unlicensed test episode', false, false)
  `, [titleId]);
});

afterAll(async () => {
  await db.close();
});

describe('watch catalogue visibility', () => {
  it('shows only curated official provider links and published licensed episodes', async () => {
    const catalog = await asAnon(() => rpc<WatchCatalog>(db, 'get_watch_catalog', { p_title_id: titleId }));
    expect(catalog.providers.map((provider) => provider.provider_name)).toEqual(['Official Stream']);
    expect(catalog.episodes).toHaveLength(1);
    expect(catalog.episodes[0]!.episode_number).toBe(1);
    expect(catalog.episodes[0]!.position_seconds).toBe(0);
  });

  it('keeps watch progress private to the signed-in member', async () => {
    await asAlice(() => rpc(db, 'save_watch_progress', {
      p_title_id: titleId,
      p_episode_id: episodeId,
      p_position_seconds: 47,
      p_duration_seconds: 120,
      p_completed: false,
    }));

    const mine = await asAlice(() => rpc<WatchCatalog>(db, 'get_watch_catalog', { p_title_id: titleId }));
    const theirs = await asBob(() => rpc<WatchCatalog>(db, 'get_watch_catalog', { p_title_id: titleId }));
    expect(mine.episodes[0]!.position_seconds).toBe(47);
    expect(mine.episodes[0]!.duration_seconds).toBe(120);
    expect(theirs.episodes[0]!.position_seconds).toBe(0);
    expect(theirs.episodes[0]!.duration_seconds).toBeNull();
  });

  it('rejects anonymous progress writes and invalid episode references', async () => {
    await expect(asAnon(() => rpc(db, 'save_watch_progress', {
      p_title_id: titleId,
      p_episode_id: episodeId,
      p_position_seconds: 10,
      p_duration_seconds: 120,
      p_completed: false,
    }))).rejects.toThrow(/permission denied/i);

    await expect(asAlice(() => rpc(db, 'save_watch_progress', {
      p_title_id: titleId,
      p_episode_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      p_position_seconds: 10,
      p_duration_seconds: 120,
      p_completed: false,
    }))).rejects.toThrow(/episode_not_available/i);
  });
});

describe('watch catalogue administration', () => {
  it('does not let ordinary members add provider links', async () => {
    await expect(asAlice(() => rpc(db, 'upsert_watch_provider', {
      p_title_id: titleId,
      p_provider_name: 'Not Allowed',
      p_url: 'https://provider.example/title',
      p_country_code: 'IN',
      p_availability: 'subscription',
    }))).rejects.toThrow(/not_watch_admin/i);
  });

  it('allows only a listed admin to upsert an official provider', async () => {
    await db.query(`insert into public.watch_catalog_admins (user_id) values ($1)`, [alice]);
    const id = await asAlice(() => rpc<string>(db, 'upsert_watch_provider', {
      p_title_id: titleId,
      p_provider_name: 'Licensed Service',
      p_url: 'https://licensed.example/watch',
      p_country_code: 'IN',
      p_availability: 'subscription',
      p_audio_languages: ['Japanese'],
      p_subtitle_languages: ['English'],
    }));
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    const catalog = await asAnon(() => rpc<WatchCatalog>(db, 'get_watch_catalog', { p_title_id: titleId }));
    expect(catalog.providers.map((provider) => provider.provider_name)).toContain('Licensed Service');
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnvFiles, parseCli, parseEnvFile, PROVIDER_NOTICES, type CliArgs } from '@/lib/ingest/cli';
import { PROVIDER_IDS } from '@/lib/providers/types';

const run = (...argv: string[]) => parseCli(argv);
const args = (...argv: string[]): CliArgs => {
  const r = parseCli(argv);
  if (r.type !== 'run') throw new Error(`expected a run, got ${JSON.stringify(r)}`);
  return r.args;
};
const error = (...argv: string[]) => {
  const r = parseCli(argv);
  if (r.type !== 'error') throw new Error(`expected an error, got ${JSON.stringify(r)}`);
  return r.message;
};

describe('parseCli', () => {
  it('reads provider, kind and defaults', () => {
    expect(args('jikan', 'anime')).toEqual({
      provider: 'jikan',
      kind: 'anime',
      pages: 1,
      startPage: 1,
      resume: false,
      relations: false,
      dryRun: false,
      listOptions: {},
    });
  });

  it('reads every option', () => {
    expect(args('jikan', 'manga', '--pages', '3', '--start-page', '4', '--relations', '--order', 'score', '--query', ' berserk ', '--dry-run')).toMatchObject({
      pages: 3,
      startPage: 4,
      relations: true,
      dryRun: true,
      listOptions: { order: 'score', query: 'berserk' },
    });
    expect(args('openlibrary', 'books', '--subject', 'science fiction').listOptions).toEqual({ subject: 'science fiction' });
    expect(args('tmdb', 'movie', '--resume').resume).toBe(true);
  });

  it('shows help for -h and --help, even with other arguments', () => {
    expect(run('--help')).toEqual({ type: 'help' });
    expect(run('-h')).toEqual({ type: 'help' });
    expect(run('jikan', 'anime', '--help')).toEqual({ type: 'help' });
  });

  it('rejects a wrong number of positionals and unknown providers', () => {
    expect(error()).toMatch(/expected <provider> and <kind>/);
    expect(error('jikan')).toMatch(/expected <provider> and <kind>/);
    expect(error('jikan', 'anime', 'extra')).toMatch(/expected <provider> and <kind>/);
    expect(error('anilist', 'anime')).toBe(`unknown provider "anilist" (use ${PROVIDER_IDS.join(', ')})`);
  });

  it('rejects unknown options with a short message', () => {
    const message = error('jikan', 'anime', '--frobnicate');
    expect(message).toMatch(/Unknown option '--frobnicate'/);
    expect(message).not.toMatch(/\n/);
  });

  it('rejects page numbers that are not whole numbers from 1', () => {
    for (const bad of ['0', '1.5', 'ten', '', '1000000', '2e3']) {
      expect(error('jikan', 'anime', '--pages', bad)).toMatch(/--pages must be a whole number/);
    }
    expect(error('jikan', 'anime', '--pages=-1')).toMatch(/--pages must be a whole number/);
    expect(error('jikan', 'anime', '--start-page', '0')).toMatch(/--start-page must be a whole number/);
  });

  it('explains a value that looks like another option', () => {
    expect(error('jikan', 'anime', '--pages', '-1')).toBe('--pages needs a value (one that starts with a dash must be written --pages=VALUE)');
  });

  it('rejects an unknown order', () => {
    expect(error('jikan', 'anime', '--order', 'random')).toBe('--order must be one of popular, score, newest');
  });

  it('only accepts search options a provider can honour', () => {
    expect(error('openlibrary', 'books')).toBe('openlibrary needs --subject or --query');
    expect(error('openlibrary', 'books', '--subject', 'x', '--query', 'y')).toBe('use either --subject or --query, not both');
    expect(error('jikan', 'anime', '--subject', 'x')).toBe('jikan does not support --subject');
    expect(error('tmdb', 'movie', '--query', 'x')).toBe('tmdb does not support --query');
    expect(error('jikan', 'anime', '--query', '   ')).toBe('--query must not be empty');
  });

  it('refuses contradictory options', () => {
    expect(error('jikan', 'anime', '--resume', '--start-page', '3')).toBe('--resume and --start-page cannot be combined');
    expect(error('jikan', 'anime', '--resume', '--dry-run')).toMatch(/needs the database/);
  });

  it('leaves kind validation to the provider, which knows what it supports', () => {
    expect(args('jikan', 'books').kind).toBe('books');
  });
});

describe('provider notices', () => {
  it('has a licence note for every provider, and the TMDB one says what the licence allows', () => {
    for (const id of PROVIDER_IDS) expect(PROVIDER_NOTICES[id].length).toBeGreaterThan(20);
    expect(PROVIDER_NOTICES.tmdb).toMatch(/non-commercial/);
    expect(PROVIDER_NOTICES.jikan).toMatch(/not been verified/);
  });
});

describe('parseEnvFile', () => {
  it('reads plain, exported and quoted values and skips comments', () => {
    const text = [
      '# a comment',
      '',
      'PLAIN=value',
      'export EXPORTED=yes',
      'SPACED = padded value  ',
      'DOUBLE="has # hash and \\"quotes\\""',
      "SINGLE='literal \\n stays'",
      'TRAILING=kept # dropped',
      'URL=postgresql://user:pa#ss@host:5432/db',
      'EMPTY=',
      'not a valid line',
      '1BAD=nope',
    ].join('\n');
    expect(parseEnvFile(text)).toEqual({
      PLAIN: 'value',
      EXPORTED: 'yes',
      SPACED: 'padded value',
      DOUBLE: 'has # hash and "quotes"',
      SINGLE: 'literal \\n stays',
      TRAILING: 'kept',
      URL: 'postgresql://user:pa#ss@host:5432/db',
      EMPTY: '',
    });
  });

  it('handles Windows line endings', () => {
    expect(parseEnvFile('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });
});

describe('loadEnvFiles', () => {
  const withDir = (files: Record<string, string>, fn: (dir: string) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sx-env-'));
    try {
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('lets the shell win over .env.local, and .env.local win over .env', () => {
    withDir({ '.env.local': 'A=local\nB=local\n', '.env': 'A=file\nB=file\nC=file\n' }, (dir) => {
      const env: Record<string, string | undefined> = { A: 'shell' };
      expect(loadEnvFiles(dir, env)).toEqual(['.env.local', '.env']);
      expect(env).toEqual({ A: 'shell', B: 'local', C: 'file' });
    });
  });

  it('copes with missing files', () => {
    withDir({}, (dir) => {
      const env: Record<string, string | undefined> = {};
      expect(loadEnvFiles(dir, env)).toEqual([]);
      expect(env).toEqual({});
    });
  });
});

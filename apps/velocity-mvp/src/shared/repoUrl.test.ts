import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from './repoUrl';

describe('parseRepoUrl', () => {
  it('parses standard https URL', () => {
    expect(parseRepoUrl('https://github.com/honojs/hono')).toEqual({ owner: 'honojs', repo: 'hono' });
  });

  it('parses git URL', () => {
    expect(parseRepoUrl('git@github.com:honojs/hono.git')).toEqual({ owner: 'honojs', repo: 'hono' });
  });

  it('rejects non-github URL', () => {
    expect(() => parseRepoUrl('https://gitlab.com/example/repo')).toThrow();
  });

  it('rejects URLs with extra path segments', () => {
    expect(() => parseRepoUrl('https://github.com/honojs/hono/issues')).toThrow();
  });
});

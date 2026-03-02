import { describe, expect, it } from 'vitest';

import {
  buildChallengeLink,
  parseChallengeQuery,
  parseRoute,
  resolveChallengeDeepLinkResolution,
  routeToPath,
  type Route,
} from './App';

describe('challenge deep-link routing contract', () => {
  it('parses valid challenge query handles', () => {
    expect(parseChallengeQuery('?challenge=octocat')).toEqual({
      targetHandle: 'octocat',
      hasInvalidQuery: false,
    });

    expect(parseRoute('/v/VelocityOwner', '?challenge=Peer-123')).toEqual({
      kind: 'profile',
      handle: 'velocityowner',
      challengeTargetHandle: 'peer-123',
      hasInvalidChallengeQuery: false,
    });
  });

  it('flags invalid challenge query handles without crashing route parse', () => {
    expect(parseChallengeQuery('?challenge=bad%20handle')).toEqual({
      targetHandle: null,
      hasInvalidQuery: true,
    });

    expect(parseRoute('/v/VelocityOwner', '?challenge=bad%20handle')).toEqual({
      kind: 'profile',
      handle: 'velocityowner',
      challengeTargetHandle: null,
      hasInvalidChallengeQuery: true,
    });
  });

  it('builds and round-trips challenge profile URLs', () => {
    const link = buildChallengeLink('https://velocity.example', 'Mentor', 'Rival_42');
    expect(link).toBe('https://velocity.example/v/mentor?challenge=rival_42');

    const path = routeToPath({
      kind: 'profile',
      handle: 'mentor',
      challengeTargetHandle: 'rival_42',
      hasInvalidChallengeQuery: false,
    });
    expect(path).toBe('/v/mentor?challenge=rival_42');
  });

  it('resolves challenge landing states deterministically', () => {
    const baseRoute: Route = {
      kind: 'profile',
      handle: 'mentor',
      challengeTargetHandle: 'rival',
      hasInvalidChallengeQuery: false,
    };

    expect(
      resolveChallengeDeepLinkResolution({
        route: baseRoute,
        challengerHandle: null,
        targetHandle: 'rival',
      }),
    ).toBe('challenger-missing');

    expect(
      resolveChallengeDeepLinkResolution({
        route: baseRoute,
        challengerHandle: 'mentor',
        targetHandle: null,
      }),
    ).toBe('target-missing');

    expect(
      resolveChallengeDeepLinkResolution({
        route: baseRoute,
        challengerHandle: 'mentor',
        targetHandle: 'mentor',
      }),
    ).toBe('self-target');

    expect(
      resolveChallengeDeepLinkResolution({
        route: baseRoute,
        challengerHandle: 'mentor',
        targetHandle: 'rival',
      }),
    ).toBe('compare-ready');

    expect(
      resolveChallengeDeepLinkResolution({
        route: {
          kind: 'profile',
          handle: 'mentor',
          challengeTargetHandle: null,
          hasInvalidChallengeQuery: true,
        },
        challengerHandle: 'mentor',
        targetHandle: null,
      }),
    ).toBe('invalid-query');

    expect(
      resolveChallengeDeepLinkResolution({
        route: { kind: 'home' },
        challengerHandle: null,
        targetHandle: null,
      }),
    ).toBe('none');
  });
});

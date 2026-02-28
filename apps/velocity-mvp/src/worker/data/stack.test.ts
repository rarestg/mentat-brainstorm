import { describe, expect, it } from 'vitest';
import type { LeaderboardEntry } from '../../shared/types';
import { detectInitialStackCrowns, inferOperatingStackTier } from './stack';

function makeEntry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 2,
    handle: 'alice',
    scannedRepos: 1,
    totals: {
      equivalentEngineeringHours: 100,
      mergedPrsUnverified: 7,
      mergedPrsCiVerified: 7,
      mergedPrs: 7,
      commitsPerDay: 2,
      activeCodingHours: 30,
      offHoursRatio: 0.2,
      velocityAcceleration: 0.1,
    },
    repos: [],
    ...overrides,
  };
}

describe('inferOperatingStackTier', () => {
  it('maps velocity signals into tiers 0-3', () => {
    expect(inferOperatingStackTier({ commitsPerDay: 10, offHoursRatio: 0.1, activeCodingHours: 120 })).toBe(0);
    expect(inferOperatingStackTier({ commitsPerDay: 16, offHoursRatio: 0.1, activeCodingHours: 180 })).toBe(1);
    expect(inferOperatingStackTier({ commitsPerDay: 34, offHoursRatio: 0.15, activeCodingHours: 260 })).toBe(2);
    expect(inferOperatingStackTier({ commitsPerDay: 62, offHoursRatio: 0.3, activeCodingHours: 560 })).toBe(3);
  });
});

describe('detectInitialStackCrowns', () => {
  it('detects crowns from ranking, off-hours ratio, shipping and acceleration', () => {
    const crowns = detectInitialStackCrowns(
      makeEntry({
        rank: 1,
        totals: {
          equivalentEngineeringHours: 220,
          mergedPrsUnverified: 12,
          mergedPrsCiVerified: 10,
          mergedPrs: 10,
          commitsPerDay: 4,
          activeCodingHours: 70,
          offHoursRatio: 0.5,
          velocityAcceleration: 0.4,
        },
      }),
    );

    expect(crowns.map((crown) => crown.key)).toEqual(['velocity-king', 'after-hours', 'shipper', 'acceleration']);
  });

  it('returns no crowns when thresholds are not met', () => {
    const crowns = detectInitialStackCrowns(makeEntry());
    expect(crowns).toEqual([]);
  });
});

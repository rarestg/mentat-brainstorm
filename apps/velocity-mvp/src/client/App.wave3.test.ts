import { describe, expect, it } from 'vitest';

import {
  buildFreshnessPresentation,
  buildVerificationPresentation,
  compactReasonText,
  mapFreshnessStaleReasonCode,
  mapVerificationReasonCode,
  summarizeAnomalies,
  summarizeFreshnessStaleReasons,
  summarizeVerificationReasonCodes,
} from './App';

describe('wave3 freshness/trust helper contracts', () => {
  it('summarizes freshness payload with cache, IDs, and timestamp markers', () => {
    const presentation = buildFreshnessPresentation('Leaderboard', {
      source: 'server',
      cacheVersion: '44:501',
      latestSuccessfulRefreshRunId: 44,
      latestSnapshotId: 501,
      latestSuccessfulRefreshGeneratedAt: '2026-03-02T01:02:03.000Z',
      latestSuccessfulRefreshFinishedAt: '2026-03-02T01:03:03.000Z',
      latestSnapshotScannedAt: '2026-03-02T01:04:03.000Z',
    });

    expect(presentation.tone).toBe('server');
    expect(presentation.headline).toContain('Leaderboard freshness');
    expect(presentation.detail).toContain('cache 44:501');
    expect(presentation.detail).toContain('snapshot #501');
    expect(presentation.detail).toContain('refresh run #44');
    expect(presentation.timestamps).toEqual([
      { label: 'Snapshot', iso: '2026-03-02T01:04:03.000Z' },
      { label: 'Refresh finished', iso: '2026-03-02T01:03:03.000Z' },
    ]);
    expect(presentation.isStale).toBe(false);
    expect(presentation.debugAttribution).toContain('schema n/a');
  });

  it('marks missing freshness payload as unavailable', () => {
    const presentation = buildFreshnessPresentation('Profile', null);

    expect(presentation.tone).toBe('missing');
    expect(presentation.headline).toBe('Profile freshness unavailable');
    expect(presentation.timestamps).toEqual([]);
    expect(presentation.debugAttribution).toBeNull();
  });

  it('switches freshness tone to stale and maps stale reason codes', () => {
    const presentation = buildFreshnessPresentation('Profile', {
      source: 'server',
      cacheVersion: '44:502',
      latestSuccessfulRefreshRunId: 44,
      latestSnapshotId: 502,
      latestSuccessfulRefreshGeneratedAt: '2026-03-03T04:00:00.000Z',
      latestSnapshotScannedAt: '2026-03-03T04:01:00.000Z',
      schemaVersion: '3.1.0',
      computedAt: '2026-03-03T04:05:00.000Z',
      isStale: true,
      staleReasons: ['snapshot-too-old', 'cache-version-fallback', 'snapshot-too-old'],
    });

    expect(presentation.tone).toBe('stale');
    expect(presentation.isStale).toBe(true);
    expect(presentation.staleReasonCodes).toEqual(['snapshot-too-old', 'cache-version-fallback', 'snapshot-too-old']);
    expect(presentation.staleReasonText).toEqual([
      'Snapshot age is outside the freshness window.',
      'Cache version fallback is active.',
    ]);
    expect(presentation.debugAttribution).toContain('schema 3.1.0');
    expect(presentation.debugAttribution).toContain('computed');
  });

  it('builds verification presentation with reason codes and threshold details', () => {
    const presentation = buildVerificationPresentation({
      state: 'pending',
      label: 'Verification Pending',
      reason: 'Fallback reason text should be ignored when reason codes are present.',
      reasonCodes: ['readiness-below-threshold', 'freshness-stale'],
      readinessScore: 74,
      readinessThreshold: 80,
      ciCoverageRatio: 0.61,
      ciCoverageThreshold: 0.7,
    });

    expect(presentation.state).toBe('pending');
    expect(presentation.toneClass).toContain('amber');
    expect(presentation.reason).toContain('Readiness score is below threshold.');
    expect(presentation.reason).toContain('Snapshot freshness is stale.');
    expect(presentation.detail).toContain('Readiness 74');
    expect(presentation.detail).toContain('CI coverage 61% / 70%+');
  });

  it('defaults verification presentation to unknown when payload is missing', () => {
    const presentation = buildVerificationPresentation(undefined);

    expect(presentation.state).toBe('unknown');
    expect(presentation.label).toBe('Verification Unknown');
  });

  it('compacts reason text and truncates long copy', () => {
    expect(compactReasonText('   short   reason   ', 32)).toBe('short reason');
    expect(compactReasonText('x'.repeat(25), 12)).toBe('xxxxxxxxx...');
  });

  it('maps verification reason code summaries with dedupe and overflow count', () => {
    expect(mapVerificationReasonCode('eligible')).toBe('All verification gates passed.');
    expect(
      summarizeVerificationReasonCodes(['readiness-missing', 'readiness-missing', 'ci-coverage-unavailable', 'freshness-stale'], 2),
    ).toBe('Readiness score is missing. | CI coverage signal is unavailable. | +1 more reason code(s).');
  });

  it('maps freshness stale reason code summaries with dedupe', () => {
    expect(mapFreshnessStaleReasonCode('missing-snapshot-timestamp')).toBe('Snapshot timestamp is missing.');
    expect(summarizeFreshnessStaleReasons(['cache-version-fallback', 'cache-version-fallback'])).toEqual([
      'Cache version fallback is active.',
    ]);
  });

  it('limits anomaly previews and reports hidden count', () => {
    const summary = summarizeAnomalies(
      [
        {
          key: 'ci-coverage-low',
          label: 'Low CI Verification Coverage',
          severity: 'high',
          reason: 'Low CI coverage.',
        },
        {
          key: 'off-hours-dominant',
          label: 'Off-Hours Dominant Output',
          severity: 'medium',
          reason: 'Output heavily off-hours.',
        },
        {
          key: 'commit-throughput-outlier',
          label: 'Commit Throughput Outlier',
          severity: 'high',
          reason: 'Commit rate appears suspicious.',
        },
      ],
      2,
    );

    expect(summary.visible).toHaveLength(2);
    expect(summary.remaining).toBe(1);
  });
});

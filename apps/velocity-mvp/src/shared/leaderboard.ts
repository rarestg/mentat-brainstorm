import { fetchTopReposForUser } from './github';
import { parseRepoUrl } from './repoUrl';
import { scanRepo } from './scanService';
import type {
  AttributionPolicy,
  AttributionTransparency,
  LeaderboardArtifact,
  LeaderboardEntry,
  SeedCreator,
} from './types';

const SEEDED_ATTRIBUTION_MODE = 'handle-authored' as const;
const SEEDED_ATTRIBUTION_POLICY: AttributionPolicy = 'strict-login-match-only';
const MANUAL_SCAN_FALLBACK_POLICY: AttributionPolicy = 'repo-wide-non-bot-default-branch';

function normalizeSeedHandle(handle: string): string | undefined {
  const normalized = handle.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function buildSeededAttribution(handle: string): AttributionTransparency {
  return {
    mode: SEEDED_ATTRIBUTION_MODE,
    source: 'github-author-login-match',
    targetHandle: handle,
    strict: true,
    productionReady: true,
    notes:
      'Seeded leaderboard attribution defaults to strict handle-authored login matching. Commits and merged PRs are counted only when author login matches the seeded handle.',
    policy: SEEDED_ATTRIBUTION_POLICY,
    confidence: 'high',
    ambiguity: 'low',
    repoWideImplications: 'Repo-wide collaborator activity is excluded from seeded attribution.',
  };
}

export async function buildLeaderboard(seed: SeedCreator[], token?: string): Promise<LeaderboardArtifact> {
  const entries: LeaderboardEntry[] = [];

  for (const creator of seed) {
    const normalizedHandle = normalizeSeedHandle(creator.handle);
    if (!normalizedHandle) {
      console.warn('[bootstrap] skipped creator with empty handle after normalization');
      continue;
    }

    const featuredRefs = [];
    for (const url of (creator.featuredRepos ?? []).slice(0, 3)) {
      try {
        featuredRefs.push(parseRepoUrl(url));
      } catch (error) {
        console.warn(`[bootstrap] invalid featured repo URL for @${creator.handle}: ${url} (${(error as Error).message})`);
      }
    }

    let refs = featuredRefs;
    if (refs.length === 0) {
      try {
        refs = (await fetchTopReposForUser(creator.handle, token)).map((repo) => {
          const [owner, name] = repo.full_name.split('/');
          return { owner, repo: name };
        });
      } catch (error) {
        console.warn(`[bootstrap] failed to resolve repos for @${creator.handle}: ${(error as Error).message}`);
        continue;
      }
    }

    const reports = [];
    for (const ref of refs.slice(0, 3)) {
      try {
        const report = await scanRepo(ref, token, {
          attribution: {
            mode: SEEDED_ATTRIBUTION_MODE,
            handle: normalizedHandle,
          },
        });
        reports.push(report);
      } catch (error) {
        // Continue scanning the rest of the seed list if one repo fails or is rate-limited.
        console.warn(`[bootstrap] failed for ${ref.owner}/${ref.repo}: ${(error as Error).message}`);
      }
    }

    if (reports.length === 0) {
      continue;
    }

    const totalEquivalentHours = reports.reduce((sum, report) => sum + report.metrics.equivalentEngineeringHours, 0);
    const totalMergedPrsUnverified = reports.reduce((sum, report) => sum + report.metrics.mergedPrsUnverified, 0);
    const totalMergedPrsCiVerified = reports.reduce((sum, report) => sum + report.metrics.mergedPrsCiVerified, 0);
    const meanCommitsPerDay = reports.reduce((sum, report) => sum + report.metrics.commitsPerDay, 0) / reports.length;
    const meanActiveHours = reports.reduce((sum, report) => sum + report.metrics.activeCodingHours, 0) / reports.length;
    const meanOffHoursRatio = reports.reduce((sum, report) => sum + report.metrics.offHoursRatio, 0) / reports.length;
    const meanAcceleration = reports.reduce((sum, report) => sum + report.metrics.velocityAcceleration, 0) / reports.length;

    entries.push({
      rank: 0,
      handle: creator.handle,
      scannedRepos: reports.length,
      featuredRepo: reports[0]?.repo.url,
      aiReadyScore: undefined,
      scanInsight:
        'Mentat Scan link pending in MVP. Seeded leaderboard refresh runs in strict handle-authored mode (GitHub author-login match only). Manual scan requests without a valid handle remain explicit repo-wide fallback.',
      attribution: reports[0]?.attribution ?? buildSeededAttribution(normalizedHandle),
      totals: {
        equivalentEngineeringHours: Math.round(totalEquivalentHours * 100) / 100,
        mergedPrsUnverified: totalMergedPrsUnverified,
        mergedPrsCiVerified: totalMergedPrsCiVerified,
        mergedPrs: totalMergedPrsCiVerified,
        commitsPerDay: Math.round(meanCommitsPerDay * 100) / 100,
        activeCodingHours: Math.round(meanActiveHours * 100) / 100,
        offHoursRatio: Math.round(meanOffHoursRatio * 100) / 100,
        velocityAcceleration: Math.round(meanAcceleration * 100) / 100,
      },
      repos: reports,
    });
  }

  const ranked = entries
    .sort((a, b) => b.totals.equivalentEngineeringHours - a.totals.equivalentEngineeringHours)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  return {
    generatedAt: new Date().toISOString(),
    sourceSeedPath: 'data/seed-creators.json',
    attributionPolicy: {
      seededLeaderboardDefaultMode: SEEDED_ATTRIBUTION_MODE,
      seededLeaderboardStrict: true,
      seededLeaderboardPolicy: SEEDED_ATTRIBUTION_POLICY,
      manualScanDefaultMode: 'repo-wide',
      manualScanFallbackPolicy: MANUAL_SCAN_FALLBACK_POLICY,
      notes:
        'Seeded leaderboard generation defaults to strict handle-authored login matching. Manual scan requests fall back to repo-wide non-bot default-branch attribution when strict handle inputs are absent or invalid.',
    },
    entries: ranked,
  };
}

import type { LeaderboardEntry, OperatingStackTier } from '../../shared/types';

export interface CrownDefinition {
  key: string;
  label: string;
}

interface TierSignalInput {
  commitsPerDay: number;
  offHoursRatio: number;
  activeCodingHours: number;
}

const CROWN_DEFINITIONS: CrownDefinition[] = [
  { key: 'velocity-king', label: 'Velocity King' },
  { key: 'after-hours', label: 'After Hours' },
  { key: 'shipper', label: 'Shipper' },
  { key: 'acceleration', label: 'Acceleration' },
  { key: 'typescript-crown', label: 'TypeScript Crown' },
  { key: 'python-crown', label: 'Python Crown' },
  { key: 'rust-crown', label: 'Rust Crown' },
  { key: 'go-crown', label: 'Go Crown' },
  { key: 'nextjs-crown', label: 'Next.js Crown' },
];

function inferOperatingStackTierFromSignals(input: TierSignalInput): OperatingStackTier {
  const avgActiveHoursPerDay = input.activeCodingHours / 30;

  if (input.commitsPerDay >= 60 && avgActiveHoursPerDay >= 18) {
    return 3;
  }
  if (input.commitsPerDay >= 30 || input.offHoursRatio >= 0.25) {
    return 2;
  }
  if (input.commitsPerDay >= 15) {
    return 1;
  }
  return 0;
}

export function inferOperatingStackTier(input: number | TierSignalInput): OperatingStackTier {
  if (typeof input === 'number') {
    const equivalentEngineeringHours = input;
    return inferOperatingStackTierFromSignals({
      commitsPerDay: Math.max(0, equivalentEngineeringHours / 4),
      offHoursRatio: equivalentEngineeringHours >= 90 ? 0.3 : 0.1,
      activeCodingHours: Math.max(0, equivalentEngineeringHours * 2),
    });
  }
  return inferOperatingStackTierFromSignals(input);
}

function detectRepoSignalCrowns(entry: LeaderboardEntry): CrownDefinition[] {
  const signalText = entry.repos
    .map((repo) => `${repo.repo.owner}/${repo.repo.name}`.toLowerCase())
    .join(' ');
  const crowns: CrownDefinition[] = [];

  if (signalText.includes('ts') || signalText.includes('typescript')) {
    crowns.push(CROWN_DEFINITIONS[4]);
  }
  if (signalText.includes('py') || signalText.includes('python')) {
    crowns.push(CROWN_DEFINITIONS[5]);
  }
  if (signalText.includes('rust') || signalText.includes('rs')) {
    crowns.push(CROWN_DEFINITIONS[6]);
  }
  if (signalText.includes('go') || signalText.includes('golang')) {
    crowns.push(CROWN_DEFINITIONS[7]);
  }
  if (signalText.includes('next')) {
    crowns.push(CROWN_DEFINITIONS[8]);
  }

  return crowns;
}

export function detectInitialStackCrowns(entry: LeaderboardEntry): CrownDefinition[] {
  const crowns: CrownDefinition[] = [];

  if (entry.rank === 1) {
    crowns.push(CROWN_DEFINITIONS[0]);
  }
  if (entry.totals.offHoursRatio >= 0.45) {
    crowns.push(CROWN_DEFINITIONS[1]);
  }
  if (entry.totals.mergedPrsCiVerified >= 8) {
    crowns.push(CROWN_DEFINITIONS[2]);
  }
  if (entry.totals.velocityAcceleration >= 0.2) {
    crowns.push(CROWN_DEFINITIONS[3]);
  }
  crowns.push(...detectRepoSignalCrowns(entry));

  return crowns.filter((crown, index, all) => all.findIndex((candidate) => candidate.key === crown.key) === index);
}

export function stackTierLabel(tier: OperatingStackTier): string {
  switch (tier) {
    case 3:
      return 'Tier 3';
    case 2:
      return 'Tier 2';
    case 1:
      return 'Tier 1';
    default:
      return 'Tier 0';
  }
}

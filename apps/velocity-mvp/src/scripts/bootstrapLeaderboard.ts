import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildLeaderboard } from '../shared/leaderboard';
import type { SeedCreator } from '../shared/types';

async function main(): Promise<void> {
  const appRoot = resolve(process.cwd());
  const seedPath = resolve(appRoot, 'data/seed-creators.json');
  const outputPath = resolve(appRoot, 'data/leaderboard.generated.json');

  const seedRaw = await readFile(seedPath, 'utf-8');
  const seed = JSON.parse(seedRaw) as SeedCreator[];
  const token = process.env.GITHUB_TOKEN;

  const artifact = await buildLeaderboard(seed, token);

  await mkdir(resolve(appRoot, 'data'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');

  console.log(`[bootstrap] wrote ${artifact.entries.length} entries to ${outputPath}`);
}

main().catch((error) => {
  console.error('[bootstrap] failed', error);
  process.exit(1);
});

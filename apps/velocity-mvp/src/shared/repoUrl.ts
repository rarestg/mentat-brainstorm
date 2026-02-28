export interface RepoRef {
  owner: string;
  repo: string;
}

export function parseRepoUrl(input: string): RepoRef {
  let normalized = input.trim();
  if (!normalized) {
    throw new Error('Repository URL cannot be empty.');
  }

  if (normalized.startsWith('git@github.com:')) {
    normalized = normalized.replace('git@github.com:', 'https://github.com/');
  }

  const url = new URL(normalized);
  if (url.hostname !== 'github.com') {
    throw new Error('Only public github.com repositories are supported in this MVP.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new Error('Expected a repository URL like https://github.com/owner/repo');
  }

  const [owner, repoRaw] = segments;
  if (!owner || !repoRaw) {
    throw new Error('Expected a repository URL like https://github.com/owner/repo');
  }

  const repo = repoRaw.replace(/\.git$/, '');
  return { owner, repo };
}

export function toRepoUrl(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}

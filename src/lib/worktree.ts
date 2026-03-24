import { execSync, ExecSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { resolveWorktreeBase, type DevmuxConfig } from './config.js';

const exec = (cmd: string, opts?: ExecSyncOptions): string =>
  (execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...opts }) as string).trim();

export interface WorktreeInfo {
  path: string;
  branch: string;
  isNew: boolean;
}

/** List existing git worktrees */
export function listWorktrees(projectRoot: string): Array<{ path: string; branch: string }> {
  const raw = exec('git worktree list --porcelain', { cwd: projectRoot });
  const worktrees: Array<{ path: string; branch: string }> = [];
  let current: { path?: string; branch?: string } = {};

  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice(9);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === '') {
      if (current.path && current.branch) {
        worktrees.push({ path: current.path, branch: current.branch });
      }
      current = {};
    }
  }
  // Handle last entry (no trailing blank line)
  if (current.path && current.branch) {
    worktrees.push({ path: current.path, branch: current.branch });
  }

  return worktrees;
}

/** Get current branch name */
export function getCurrentBranch(cwd: string = process.cwd()): string {
  return exec('git rev-parse --abbrev-ref HEAD', { cwd });
}

/** Check if a branch exists locally or remotely */
export function branchExists(branch: string, projectRoot: string): boolean {
  try {
    exec(`git rev-parse --verify ${branch}`, { cwd: projectRoot });
    return true;
  } catch {
    try {
      exec(`git rev-parse --verify origin/${branch}`, { cwd: projectRoot });
      return true;
    } catch {
      return false;
    }
  }
}

/** Create or reuse a worktree for the given branch */
export function ensureWorktree(
  branch: string,
  projectRoot: string,
  config: DevmuxConfig,
): WorktreeInfo {
  const base = resolveWorktreeBase(projectRoot, config);
  const worktreeDir = resolve(base, branch.replace(/\//g, '-'));

  // Check if worktree already exists
  const existing = listWorktrees(projectRoot);
  const match = existing.find((w) => w.branch === branch && w.path === worktreeDir);
  if (match) {
    return { path: match.path, branch: match.branch, isNew: false };
  }

  // Check if directory already exists (stale worktree)
  if (existsSync(worktreeDir)) {
    try {
      exec(`git worktree remove "${worktreeDir}" --force`, { cwd: projectRoot });
    } catch {
      // Directory exists but isn't a worktree — user problem
      throw new Error(`Directory ${worktreeDir} already exists and is not a git worktree`);
    }
  }

  // Create the worktree
  if (branchExists(branch, projectRoot)) {
    exec(`git worktree add "${worktreeDir}" "${branch}"`, { cwd: projectRoot });
  } else {
    // Create new branch from current HEAD
    exec(`git worktree add -b "${branch}" "${worktreeDir}"`, { cwd: projectRoot });
  }

  return { path: worktreeDir, branch, isNew: true };
}

/** Remove a worktree */
export function removeWorktree(worktreeDir: string, projectRoot: string): void {
  try {
    exec(`git worktree remove "${worktreeDir}" --force`, { cwd: projectRoot });
  } catch {
    // Already removed or not a worktree
  }
}

/** Get the project name from the root package.json or directory name */
export function getProjectName(projectRoot: string): string {
  try {
    const pkg = JSON.parse(exec(`cat package.json`, { cwd: projectRoot }));
    return pkg.name || basename(projectRoot);
  } catch {
    return basename(projectRoot);
  }
}

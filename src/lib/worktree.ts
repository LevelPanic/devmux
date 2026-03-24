import { execFileSync, ExecFileSyncOptions } from 'node:child_process';
import { existsSync, readFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';
import { resolveWorktreeBase, type DevmuxConfig } from './config.js';

/** Safe exec — uses execFileSync to avoid shell injection */
function git(args: string[], opts?: ExecFileSyncOptions): string {
  return (execFileSync('git', args, { encoding: 'utf-8', stdio: 'pipe', ...opts }) as string).trim();
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  isNew: boolean;
}

/** Validate a branch name against git's own rules */
function isValidBranchName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  // Reject shell metacharacters, control chars, spaces, tildes, colons, etc.
  if (/[\x00-\x1f\x7f ~^:?*\[\\]/.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name.endsWith('.lock')) return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  return true;
}

/** Throws if branch name is unsafe */
export function validateBranch(branch: string): void {
  if (!isValidBranchName(branch)) {
    throw new Error(`Invalid branch name: "${branch}"`);
  }
}

/** List existing git worktrees */
export function listWorktrees(projectRoot: string): Array<{ path: string; branch: string }> {
  const raw = git(['worktree', 'list', '--porcelain'], { cwd: projectRoot });
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
  if (current.path && current.branch) {
    worktrees.push({ path: current.path, branch: current.branch });
  }

  return worktrees;
}

/** Get current branch name */
export function getCurrentBranch(cwd: string = process.cwd()): string {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
}

/** Check if a branch exists locally or remotely */
export function branchExists(branch: string, projectRoot: string): boolean {
  validateBranch(branch);
  try {
    git(['rev-parse', '--verify', branch], { cwd: projectRoot });
    return true;
  } catch {
    try {
      git(['rev-parse', '--verify', `origin/${branch}`], { cwd: projectRoot });
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
  validateBranch(branch);
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
      git(['worktree', 'remove', worktreeDir, '--force'], { cwd: projectRoot });
    } catch {
      throw new Error(`Directory ${worktreeDir} already exists and is not a git worktree`);
    }
  }

  // Create the worktree
  if (branchExists(branch, projectRoot)) {
    git(['worktree', 'add', worktreeDir, branch], { cwd: projectRoot });
  } else {
    git(['worktree', 'add', '-b', branch, worktreeDir], { cwd: projectRoot });
  }

  // Symlink env files from main repo
  if (config.envFiles && config.envFiles.length > 0) {
    symlinkEnvFiles(projectRoot, worktreeDir, config.envFiles);
  }

  return { path: worktreeDir, branch, isNew: true };
}

/** Symlink env files from the main repo into a worktree */
export function symlinkEnvFiles(projectRoot: string, worktreeDir: string, envFiles: string[]): { linked: string[]; missing: string[] } {
  const linked: string[] = [];
  const missing: string[] = [];

  for (const relPath of envFiles) {
    const source = resolve(projectRoot, relPath);
    const target = resolve(worktreeDir, relPath);

    if (!existsSync(source)) {
      missing.push(relPath);
      continue;
    }

    // Don't overwrite if file already exists in worktree
    if (existsSync(target)) continue;

    // Ensure target directory exists
    const targetDir = dirname(target);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    try {
      symlinkSync(source, target);
      linked.push(relPath);
    } catch {
      // Symlink failed (e.g., Windows without dev mode) — skip
      missing.push(relPath);
    }
  }

  return { linked, missing };
}

/** Remove a worktree */
export function removeWorktree(worktreeDir: string, projectRoot: string): void {
  try {
    git(['worktree', 'remove', worktreeDir, '--force'], { cwd: projectRoot });
  } catch {
    // Already removed or not a worktree
  }
}

/** Get the project name from the root package.json or directory name */
export function getProjectName(projectRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf-8'));
    return pkg.name || basename(projectRoot);
  } catch {
    return basename(projectRoot);
  }
}

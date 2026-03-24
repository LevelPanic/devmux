import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot, loadConfig } from '../lib/config.js';
import { configFileName } from '../lib/paths.js';
import { bold, green, yellow, cyan, dim, symbols } from '../lib/colors.js';

function isInGitignore(projectRoot: string): boolean {
  const gitignorePath = join(projectRoot, '.gitignore');
  if (!existsSync(gitignorePath)) return false;
  const content = readFileSync(gitignorePath, 'utf-8');
  return content.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed === '.devmux.json' || trimmed === '.devmux.json\r';
  });
}

export function init(): void {
  const projectRoot = findProjectRoot();
  const configPath = join(projectRoot, configFileName());

  if (existsSync(configPath)) {
    console.log(`${yellow(symbols.warning)} ${configFileName()} already exists at ${dim(configPath)}`);
    console.log(`${dim('Delete it and re-run to regenerate from repo detection')}`);
    return;
  }

  // loadConfig auto-detects and writes the file
  const config = loadConfig(projectRoot);

  console.log(`${green(symbols.tick)} Created ${bold(configFileName())} at ${dim(configPath)}`);
  console.log('');
  console.log(`  ${bold('Detected:')}`);
  console.log(`    Project:         ${cyan(config.name)}`);
  console.log(`    Package manager: ${cyan(config.packageManager)}`);
  console.log(`    Dev command:     ${cyan(config.command)}`);
  console.log(`    Post-create:     ${cyan(config.postCreate)}`);

  // Warn about .gitignore
  if (!isInGitignore(projectRoot)) {
    console.log('');
    console.log(`  ${yellow(symbols.warning)} ${bold('.devmux.json')} is not in your .gitignore`);
    console.log(`    Port mappings are machine-specific — consider adding it:`);
    console.log(`    ${dim('echo ".devmux.json" >> .gitignore')}`);
  }

  console.log('');
  console.log(`  ${dim('Edit .devmux.json to customize, or just run')} devmux up <branch>`);
}

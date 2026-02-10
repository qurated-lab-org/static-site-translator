#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import { readFileSync } from 'fs';
import { join } from 'path';
import { initCommand } from './commands/init';
import { translateCommand } from './commands/translate';

// Get package version (CommonJS compatible)
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

// Display banner
const banner = boxen(
  chalk.bold.cyan('🌍 AI Static Translator\n') +
  chalk.gray('Smart multi-language translator for static sites'),
  { padding: 1, margin: 0, borderStyle: 'round' }
);

program
  .name('ai-static-translator')
  .description('Translate your static site to multiple languages using OpenAI')
  .version(packageJson.version)
  .addHelpText('before', banner + '\n');

// Init command
program
  .command('init')
  .description('Initialize configuration with interactive wizard')
  .action(async () => {
    try {
      await initCommand();
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Translate command (default)
program
  .command('translate', { isDefault: true })
  .description('Translate your static site based on configuration')
  .option('-c, --config <path>', 'path to configuration file')
  .option('-d, --dry-run', 'show what would be translated without making API calls')
  .option('--clear-cache', 'clear translation cache before starting')
  .option('-v, --verbose', 'show detailed output')
  .action(async (options) => {
    try {
      await translateCommand(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
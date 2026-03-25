import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import ora from 'ora';
import pLimit from 'p-limit';
import boxen from 'boxen';
import { TranslatorConfig, FileTranslationResult, TranslationStats } from '../types';
import { loadConfig } from '../utils/config';
import { CacheManager } from '../utils/cache';
import { Translator } from '../core/translator';
import { HtmlProcessor } from '../core/html-processor';

export async function translateCommand(options: {
  config?: string;
  dryRun?: boolean;
  clearCache?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const startTime = Date.now();
  let spinner = ora('Loading configuration...').start();

  try {
    // Load configuration
    const config = await loadConfig(options.config);
    spinner.succeed('Configuration loaded');

    // Initialize cache
    const cacheManager = new CacheManager(
      config.cache?.directory || '.translator-cache',
      config.cache?.enabled !== false
    );

    if (options.clearCache) {
      spinner = ora('Clearing cache...').start();
      await cacheManager.clear();
      spinner.succeed('Cache cleared');
    }

    await cacheManager.initialize();

    // Find all HTML files
    spinner = ora('Scanning for HTML files...').start();
    const sourceDir = path.resolve(config.sourceDir);
    const htmlFiles = await glob('**/*.html', {
      cwd: sourceDir,
      ignore: config.ignorePaths || [],
    });

    if (htmlFiles.length === 0) {
      spinner.fail('No HTML files found');
      return;
    }

    spinner.succeed(`Found ${htmlFiles.length} HTML files`);

    // Dry run mode
    if (options.dryRun) {
      await performDryRun(htmlFiles, config);
      return;
    }

    // Initialize translator
    const translator = new Translator(config);

    // Set up parallel processing
    const limit = pLimit(config.parallel?.limit || 5);

    // Statistics
    const stats: TranslationStats = {
      totalFiles: htmlFiles.length * config.targetLanguages.length,
      successfulFiles: 0,
      failedFiles: 0,
      totalTokens: 0,
      estimatedCost: 0,
      duration: 0,
    };

    const results: FileTranslationResult[] = [];

    // Process each file for each language
    console.log(chalk.cyan('\n📝 Starting translation process...\n'));

    const tasks = [];
    for (const htmlFile of htmlFiles) {
      tasks.push(
        limit(async () => {
          const sourcePath = path.join(sourceDir, htmlFile);
          const htmlContent = await fs.readFile(sourcePath, 'utf-8');

          // Parse HTML once, then translate for all languages in parallel
          const sharedProcessor = new HtmlProcessor(config);
          let extracted: { translatable: string[]; mapping: Map<string, string>; processedHtml: string } | null = null;

          // Check if all languages are cached (skip parsing if so)
          const allCached = await Promise.all(
            config.targetLanguages.map(lang => cacheManager.get(htmlFile, htmlContent, lang).then(v => v ?? null))
          );

          if (!allCached.every(Boolean)) {
            extracted = await sharedProcessor.extractTranslatableContent(htmlContent);
          }

          await Promise.all(
            config.targetLanguages.map(async (targetLanguage, idx) => {
              const result = await translateFileWithExtracted(
                htmlFile,
                targetLanguage,
                sourceDir,
                htmlContent,
                allCached[idx] ?? null,
                extracted,
                sharedProcessor,
                config,
                translator,
                cacheManager,
                options.verbose || false
              );
              results.push(result);

              if (result.success) {
                stats.successfulFiles++;
                if (result.tokensUsed) stats.totalTokens += result.tokensUsed;
              } else {
                stats.failedFiles++;
              }

              const progress = Math.round(
                ((stats.successfulFiles + stats.failedFiles) / stats.totalFiles) * 100
              );

              if (result.success) {
                console.log(
                  chalk.green('✓') +
                  ` ${chalk.gray(htmlFile)} → ${chalk.cyan(targetLanguage)} ` +
                  chalk.gray(`(${progress}%)`)
                );
              } else {
                console.log(
                  chalk.red('✗') +
                  ` ${chalk.gray(htmlFile)} → ${chalk.cyan(targetLanguage)} ` +
                  chalk.red(`Failed: ${result.error}`)
                );
              }
            })
          );
        })
      );
    }

    // Wait for all translations to complete
    await Promise.all(tasks);

    // Calculate final statistics
    stats.duration = (Date.now() - startTime) / 1000;
    stats.estimatedCost = translator.estimateCost();

    // Display results
    displayResults(stats);

    // Save translation report
    await saveReport(results, stats, config.outputDir);

  } catch (error) {
    spinner.fail(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

async function translateFileWithExtracted(
  htmlFile: string,
  targetLanguage: string,
  sourceDir: string,
  htmlContent: string,
  cachedTranslation: string | null,
  extracted: { translatable: string[]; mapping: Map<string, string>; processedHtml: string } | null,
  sharedProcessor: HtmlProcessor,
  config: TranslatorConfig,
  translator: Translator,
  cacheManager: CacheManager,
  verbose: boolean
): Promise<FileTranslationResult> {
  const sourcePath = path.join(sourceDir, htmlFile);
  const targetPath = path.join(config.outputDir, targetLanguage, htmlFile);

  try {
    if (cachedTranslation) {
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, cachedTranslation, 'utf-8');

      if (verbose) {
        console.log(chalk.blue(`  [CACHE] ${htmlFile} → ${targetLanguage}`));
      }

      return { source: sourcePath, target: targetPath, language: targetLanguage, success: true };
    }

    if (!extracted || extracted.translatable.length === 0) {
      const { processedHtml } = extracted || await sharedProcessor.extractTranslatableContent(htmlContent);
      const translatedHtml = await sharedProcessor.applyTranslations(processedHtml, {}, targetLanguage);
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, translatedHtml, 'utf-8');
      return { source: sourcePath, target: targetPath, language: targetLanguage, success: true };
    }

    const { translatable, mapping, processedHtml } = extracted;

    const translations = await translator.translateTexts(translatable, targetLanguage, mapping);

    const translatedHtml = await sharedProcessor.applyTranslations(processedHtml, translations, targetLanguage);

    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, translatedHtml, 'utf-8');

    await cacheManager.set(htmlFile, htmlContent, targetLanguage, translatedHtml);

    return {
      source: sourcePath,
      target: targetPath,
      language: targetLanguage,
      success: true,
      tokensUsed: translator.getTokensUsed(),
    };

  } catch (error) {
    return {
      source: sourcePath,
      target: targetPath,
      language: targetLanguage,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function performDryRun(
  htmlFiles: string[],
  config: TranslatorConfig
): Promise<void> {
  console.log(boxen(
    chalk.yellow.bold('🔍 DRY RUN MODE\n\n') +
    chalk.white('Files to translate: ') + chalk.cyan(htmlFiles.length) + '\n' +
    chalk.white('Target languages: ') + chalk.cyan(config.targetLanguages.join(', ')) + '\n' +
    chalk.white('Total operations: ') + chalk.cyan(htmlFiles.length * config.targetLanguages.length) + '\n\n' +
    chalk.gray('Estimated tokens: ~') + chalk.yellow((htmlFiles.length * 500 * config.targetLanguages.length).toLocaleString()) + '\n' +
    chalk.gray('Estimated cost: ~$') + chalk.yellow(((htmlFiles.length * 500 * config.targetLanguages.length * 0.00015) / 1000).toFixed(2)),
    { padding: 1, margin: 1, borderStyle: 'round' }
  ));

  console.log(chalk.cyan('\nFiles to be translated:'));
  htmlFiles.forEach(file => {
    console.log(chalk.gray(`  - ${file}`));
  });
}

function displayResults(stats: TranslationStats): void {
  const successRate = Math.round((stats.successfulFiles / stats.totalFiles) * 100);

  console.log(boxen(
    chalk.green.bold('✨ Translation Complete!\n\n') +
    chalk.white('Total files: ') + chalk.cyan(stats.totalFiles) + '\n' +
    chalk.white('Successful: ') + chalk.green(stats.successfulFiles) + '\n' +
    chalk.white('Failed: ') + chalk.red(stats.failedFiles) + '\n' +
    chalk.white('Success rate: ') + (successRate >= 80 ? chalk.green : chalk.yellow)(`${successRate}%`) + '\n\n' +
    chalk.white('Tokens used: ') + chalk.cyan(stats.totalTokens.toLocaleString()) + '\n' +
    chalk.white('Estimated cost: ') + chalk.yellow(`$${stats.estimatedCost.toFixed(4)}`) + '\n' +
    chalk.white('Duration: ') + chalk.cyan(`${stats.duration.toFixed(1)}s`),
    { padding: 1, margin: 1, borderStyle: 'round' }
  ));
}

async function saveReport(
  results: FileTranslationResult[],
  stats: TranslationStats,
  outputDir: string
): Promise<void> {
  const reportPath = path.join(outputDir, 'translation-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    stats,
    results: results.map(r => ({
      ...r,
      source: path.relative(process.cwd(), r.source),
      target: path.relative(process.cwd(), r.target),
    })),
  };

  await fs.ensureDir(outputDir);
  await fs.writeJson(reportPath, report, { spaces: 2 });
  console.log(chalk.gray(`\nReport saved to: ${reportPath}`));
}
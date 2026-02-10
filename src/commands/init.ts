import inquirer from 'inquirer';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import { TranslatorConfig } from '../types';
import { validateLanguageCode, saveConfig } from '../utils/config';

export async function initCommand(): Promise<void> {
  console.log(boxen(
    chalk.bold.cyan('🌍 AI Static Translator Setup Wizard'),
    { padding: 1, margin: 1, borderStyle: 'round' }
  ));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'sourceDir',
      message: 'Source directory path (where your HTML files are):',
      default: './dist',
      validate: async (input: string) => {
        const absPath = path.resolve(input);
        if (await fs.pathExists(absPath)) {
          return true;
        }
        return `Directory "${input}" does not exist`;
      },
    },
    {
      type: 'input',
      name: 'outputDir',
      message: 'Output directory path (where translations will be saved):',
      default: './dist-i18n',
    },
    {
      type: 'input',
      name: 'targetLanguages',
      message: 'Target languages (comma-separated, e.g., es,fr,de,ja):',
      validate: (input: string) => {
        const languages = input.split(',').map(l => l.trim());
        if (languages.length === 0) {
          return 'Please enter at least one language';
        }
        for (const lang of languages) {
          if (!validateLanguageCode(lang)) {
            return `Invalid language code: ${lang}. Use ISO 639-1 format (e.g., 'es' or 'es-MX')`;
          }
        }
        return true;
      },
      filter: (input: string) => input.split(',').map(l => l.trim()),
    },
    {
      type: 'password',
      name: 'openaiApiKey',
      message: 'OpenAI API Key (will be saved to .env file):',
      validate: (input: string) => {
        if (!input) {
          return 'API key is required';
        }
        if (!input.startsWith('sk-')) {
          return 'Invalid API key format (should start with sk-)';
        }
        return true;
      },
    },
    {
      type: 'list',
      name: 'openaiModel',
      message: 'Select OpenAI model:',
      choices: [
        { name: 'GPT-4o mini (Recommended - Fast & Affordable)', value: 'gpt-4o-mini' },
        { name: 'GPT-4o (Higher quality)', value: 'gpt-4o' },
        { name: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
      ],
      default: 'gpt-4o-mini',
    },
    {
      type: 'confirm',
      name: 'enableCache',
      message: 'Enable caching to save API costs?',
      default: true,
    },
    {
      type: 'number',
      name: 'parallelLimit',
      message: 'Number of parallel API requests (1-20):',
      default: 5,
      validate: (input: number) => {
        if (input < 1 || input > 20) {
          return 'Please enter a number between 1 and 20';
        }
        return true;
      },
    },
    {
      type: 'confirm',
      name: 'injectHreflang',
      message: 'Auto-inject hreflang tags for SEO?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'setupGlossary',
      message: 'Would you like to set up a glossary for consistent translations?',
      default: false,
    },
  ]);

  const config: TranslatorConfig = {
    sourceDir: answers.sourceDir,
    outputDir: answers.outputDir,
    targetLanguages: answers.targetLanguages,
    openaiModel: answers.openaiModel,
    cache: {
      enabled: answers.enableCache,
      directory: '.translator-cache',
    },
    parallel: {
      limit: answers.parallelLimit,
    },
    seo: {
      injectHreflang: answers.injectHreflang,
      localizeMetaTags: true,
    },
    safety: {
      preserveCodeBlocks: true,
      preserveScripts: true,
      preserveStyles: true,
    },
  };

  // Setup glossary if requested
  if (answers.setupGlossary) {
    console.log(chalk.yellow('\n📚 Glossary Setup'));
    const glossaryTerms = await inquirer.prompt([
      {
        type: 'input',
        name: 'terms',
        message: 'Enter terms to translate consistently (comma-separated, e.g., "Company Name,Product"):',
      },
    ]);

    if (glossaryTerms.terms) {
      config.glossary = {};
      const terms = glossaryTerms.terms.split(',').map((t: string) => t.trim());

      for (const lang of answers.targetLanguages) {
        console.log(chalk.cyan(`\nTranslations for ${lang}:`));
        config.glossary[lang] = {};

        for (const term of terms) {
          const translation = await inquirer.prompt([
            {
              type: 'input',
              name: 'translation',
              message: `How should "${term}" be translated to ${lang}? (leave empty to keep original):`,
            },
          ]);

          if (translation.translation) {
            config.glossary[lang][term] = translation.translation;
          }
        }
      }
    }
  }

  // Save configuration
  await saveConfig(config);
  console.log(chalk.green('✅ Configuration saved to translator.config.json'));

  // Save API key to .env
  const envPath = path.join(process.cwd(), '.env');
  const envContent = `OPENAI_API_KEY=${answers.openaiApiKey}\n`;

  if (await fs.pathExists(envPath)) {
    const existingEnv = await fs.readFile(envPath, 'utf-8');
    if (!existingEnv.includes('OPENAI_API_KEY')) {
      await fs.appendFile(envPath, envContent);
    } else {
      console.log(chalk.yellow('⚠️  OPENAI_API_KEY already exists in .env file'));
    }
  } else {
    await fs.writeFile(envPath, envContent);
  }

  console.log(chalk.green('✅ API key saved to .env file'));

  // Create .gitignore if it doesn't exist
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  if (await fs.pathExists(gitignorePath)) {
    const gitignore = await fs.readFile(gitignorePath, 'utf-8');
    if (!gitignore.includes('.env')) {
      await fs.appendFile(gitignorePath, '\n.env\n');
    }
    if (!gitignore.includes('.translator-cache')) {
      await fs.appendFile(gitignorePath, '.translator-cache/\n');
    }
  } else {
    await fs.writeFile(gitignorePath, '.env\n.translator-cache/\nnode_modules/\ndist/\n');
  }

  console.log(boxen(
    chalk.green.bold('🎉 Setup Complete!\n\n') +
    chalk.white('Run ') +
    chalk.cyan('npx ai-static-translator translate') +
    chalk.white(' to start translating your site.'),
    { padding: 1, margin: 1, borderStyle: 'round' }
  ));
}
import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { TranslatorConfig } from '../types';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const ConfigSchema = z.object({
  sourceDir: z.string().min(1),
  outputDir: z.string().min(1),
  targetLanguages: z.array(z.string()).min(1),
  openaiApiKey: z.string().optional(),
  openaiModel: z.string().optional().default('gpt-4o-mini'),
  glossary: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  ignorePaths: z.array(z.string()).optional(),
  cache: z.object({
    enabled: z.boolean().optional().default(true),
    directory: z.string().optional().default('.translator-cache'),
  }).optional(),
  parallel: z.object({
    limit: z.number().min(1).max(20).optional().default(5),
  }).optional(),
  seo: z.object({
    injectHreflang: z.boolean().optional().default(true),
    localizeMetaTags: z.boolean().optional().default(true),
  }).optional(),
  safety: z.object({
    preserveCodeBlocks: z.boolean().optional().default(true),
    preserveScripts: z.boolean().optional().default(true),
    preserveStyles: z.boolean().optional().default(true),
  }).optional(),
});

export async function loadConfig(configPath?: string): Promise<TranslatorConfig> {
  const defaultPath = path.join(process.cwd(), 'translator.config.json');
  const configFile = configPath || defaultPath;

  if (!await fs.pathExists(configFile)) {
    throw new Error(`Configuration file not found: ${configFile}`);
  }

  const rawConfig = await fs.readJson(configFile);

  // Override API key from environment if not in config
  if (!rawConfig.openaiApiKey && process.env.OPENAI_API_KEY) {
    rawConfig.openaiApiKey = process.env.OPENAI_API_KEY;
  }

  try {
    const config = ConfigSchema.parse(rawConfig);

    // Set defaults
    if (!config.cache) {
      config.cache = { enabled: true, directory: '.translator-cache' };
    }
    if (!config.parallel) {
      config.parallel = { limit: 5 };
    }
    if (!config.seo) {
      config.seo = { injectHreflang: true, localizeMetaTags: true };
    }
    if (!config.safety) {
      config.safety = {
        preserveCodeBlocks: true,
        preserveScripts: true,
        preserveStyles: true,
      };
    }

    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue =>
        `  - ${issue.path.join('.')}: ${issue.message}`
      ).join('\n');
      throw new Error(`Invalid configuration:\n${issues}`);
    }
    throw error;
  }
}

export async function saveConfig(config: TranslatorConfig, configPath?: string): Promise<void> {
  const defaultPath = path.join(process.cwd(), 'translator.config.json');
  const configFile = configPath || defaultPath;

  await fs.writeJson(configFile, config, { spaces: 2 });
}

export function validateLanguageCode(code: string): boolean {
  // Basic ISO 639-1 language code validation
  const languageCodeRegex = /^[a-z]{2}(-[A-Z]{2})?$/;
  return languageCodeRegex.test(code);
}
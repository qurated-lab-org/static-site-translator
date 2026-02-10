import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import { TranslationCache } from '../types';

export class CacheManager {
  private cacheDir: string;
  private enabled: boolean;

  constructor(cacheDir: string, enabled: boolean = true) {
    this.cacheDir = cacheDir;
    this.enabled = enabled;
  }

  async initialize(): Promise<void> {
    if (this.enabled) {
      await fs.ensureDir(this.cacheDir);
    }
  }

  private generateHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private getCacheFilePath(sourceFile: string, language: string): string {
    const hash = this.generateHash(`${sourceFile}-${language}`);
    return path.join(this.cacheDir, `${hash}.json`);
  }

  async get(
    sourceFile: string,
    content: string,
    language: string
  ): Promise<string | null> {
    if (!this.enabled) return null;

    const cacheFile = this.getCacheFilePath(sourceFile, language);

    try {
      if (await fs.pathExists(cacheFile)) {
        const cache: TranslationCache = await fs.readJson(cacheFile);
        const contentHash = this.generateHash(content);

        // Check if content hasn't changed
        if (cache.hash === contentHash && cache.translations[language]) {
          return cache.translations[language];
        }
      }
    } catch (error) {
      // Cache miss or error, continue without cache
      console.warn(`Cache read error for ${sourceFile}: ${error}`);
    }

    return null;
  }

  async set(
    sourceFile: string,
    content: string,
    language: string,
    translation: string
  ): Promise<void> {
    if (!this.enabled) return;

    const cacheFile = this.getCacheFilePath(sourceFile, language);
    const contentHash = this.generateHash(content);

    let cache: TranslationCache;

    try {
      if (await fs.pathExists(cacheFile)) {
        cache = await fs.readJson(cacheFile);
      } else {
        cache = {
          hash: contentHash,
          translations: {},
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      cache = {
        hash: contentHash,
        translations: {},
        timestamp: Date.now(),
      };
    }

    cache.hash = contentHash;
    cache.translations[language] = translation;
    cache.timestamp = Date.now();

    try {
      await fs.writeJson(cacheFile, cache, { spaces: 2 });
    } catch (error) {
      console.warn(`Cache write error for ${sourceFile}: ${error}`);
    }
  }

  async clear(): Promise<void> {
    if (this.enabled && await fs.pathExists(this.cacheDir)) {
      await fs.emptyDir(this.cacheDir);
    }
  }

  async getStats(): Promise<{
    totalCached: number;
    cacheSize: number;
  }> {
    if (!this.enabled || !(await fs.pathExists(this.cacheDir))) {
      return { totalCached: 0, cacheSize: 0 };
    }

    const files = await fs.readdir(this.cacheDir);
    let totalSize = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }
    }

    return {
      totalCached: files.filter(f => f.endsWith('.json')).length,
      cacheSize: totalSize,
    };
  }
}
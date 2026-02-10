export interface TranslatorConfig {
  sourceDir: string;
  outputDir: string;
  targetLanguages: string[];
  openaiApiKey?: string;
  openaiModel?: string;
  glossary?: Record<string, Record<string, string>>;
  ignorePaths?: string[];
  cache?: {
    enabled?: boolean;
    directory?: string;
  };
  parallel?: {
    limit?: number;
  };
  seo?: {
    injectHreflang?: boolean;
    localizeMetaTags?: boolean;
  };
  safety?: {
    preserveCodeBlocks?: boolean;
    preserveScripts?: boolean;
    preserveStyles?: boolean;
  };
}

export interface TranslationCache {
  hash: string;
  translations: Record<string, string>;
  timestamp: number;
}

export interface FileTranslationResult {
  source: string;
  target: string;
  language: string;
  success: boolean;
  error?: string;
  tokensUsed?: number;
}

export interface TranslationStats {
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  totalTokens: number;
  estimatedCost: number;
  duration: number;
}

export interface HtmlElement {
  type: 'text' | 'element' | 'skip';
  content: string;
  attributes?: Record<string, string>;
  children?: HtmlElement[];
}
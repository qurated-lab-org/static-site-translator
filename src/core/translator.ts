import OpenAI from 'openai';
import { TranslatorConfig } from '../types';

export class Translator {
  private openai: OpenAI;
  private config: TranslatorConfig;
  private tokensUsed: number = 0;

  constructor(config: TranslatorConfig) {
    this.config = config;

    if (!config.openaiApiKey) {
      throw new Error('OpenAI API key is required. Set it in config or OPENAI_API_KEY environment variable.');
    }

    this.openai = new OpenAI({
      apiKey: config.openaiApiKey,
    });
  }

  async translateBatch(
    texts: string[],
    targetLanguage: string,
    context?: { isTitle?: boolean; isMeta?: boolean }
  ): Promise<Record<string, string>> {
    if (texts.length === 0) {
      return {};
    }

    const glossaryPrompt = this.buildGlossaryPrompt(targetLanguage);
    const contextPrompt = this.buildContextPrompt(context);

    const systemPrompt = `You are a professional translator specializing in website localization.
${contextPrompt}
${glossaryPrompt}
Rules:
1. Maintain the original tone and style
2. Do not translate technical terms that should remain in English (like brand names, unless specified in glossary)
3. For SEO elements (titles, meta descriptions), optimize for the target language's search patterns
4. Preserve any HTML entities or special characters
5. Return translations in the exact same order as input
6. Keep translations natural and culturally appropriate for ${targetLanguage}`;

    const userPrompt = `Translate the following texts to ${targetLanguage}.
Return ONLY the translations, one per line, in the same order:

${texts.map((text, i) => `${i + 1}. ${text}`).join('\n')}`;

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        const response = await this.openai.chat.completions.create({
          model: this.config.openaiModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: Math.min(4096, texts.join('').length * 3),
        });

        const content = response.choices[0]?.message?.content || '';
        const translations = content.split('\n')
          .map(line => line.replace(/^\d+\.\s*/, '').trim())
          .filter(line => line.length > 0);

        // Track token usage for cost estimation
        if (response.usage) {
          this.tokensUsed += response.usage.total_tokens;
        }

        // Create mapping
        const result: Record<string, string> = {};
        texts.forEach((text, index) => {
          result[text] = translations[index] || text; // Fallback to original if translation missing
        });

        return result;
      } catch (error: any) {
        retries++;

        // Check if it's a rate limit error
        if (error?.status === 429 || error?.code === 'rate_limit_exceeded') {
          if (retries < maxRetries) {
            const waitTime = Math.min(1000 * Math.pow(2, retries), 10000); // Exponential backoff
            console.warn(`Rate limit hit, waiting ${waitTime}ms before retry ${retries}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }

        console.error('Translation API error:', error);
        throw new Error(`Failed to translate: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // This should never be reached, but TypeScript requires it
    throw new Error('Failed to translate after maximum retries');
  }

  async translateTexts(
    texts: string[],
    targetLanguage: string,
    mapping: Map<string, string>
  ): Promise<Record<string, string>> {
    const uniqueTexts = Array.from(new Set(texts));
    const batchSize = 50; // Process in batches to avoid token limits
    const translatedTexts: Record<string, string> = {};

    for (let i = 0; i < uniqueTexts.length; i += batchSize) {
      const batch = uniqueTexts.slice(i, i + batchSize);

      // Determine context based on keys
      const context: any = {};
      for (const [key, value] of mapping.entries()) {
        if (batch.includes(value)) {
          if (key === '__TITLE__') context.isTitle = true;
          if (key.startsWith('__META_')) context.isMeta = true;
        }
      }

      const batchTranslations = await this.translateBatch(batch, targetLanguage, context);
      Object.assign(translatedTexts, batchTranslations);
    }

    // Map back using original keys
    const result: Record<string, string> = {};
    for (const [key, originalText] of mapping.entries()) {
      result[key] = translatedTexts[originalText] || originalText;
    }

    return result;
  }

  private buildGlossaryPrompt(targetLanguage: string): string {
    if (!this.config.glossary || !this.config.glossary[targetLanguage]) {
      return '';
    }

    const glossary = this.config.glossary[targetLanguage];
    const entries = Object.entries(glossary)
      .map(([term, translation]) => `- "${term}" → "${translation}"`)
      .join('\n');

    return `\nGlossary (use these translations consistently):\n${entries}\n`;
  }

  private buildContextPrompt(context?: { isTitle?: boolean; isMeta?: boolean }): string {
    if (!context) return '';

    if (context.isTitle) {
      return 'You are translating a page title. Keep it concise and SEO-friendly.';
    }

    if (context.isMeta) {
      return 'You are translating meta descriptions. Optimize for search engines while maintaining the message.';
    }

    return '';
  }

  getTokensUsed(): number {
    return this.tokensUsed;
  }

  estimateCost(): number {
    // Rough estimation based on GPT-4 mini pricing
    const costPer1kTokens = 0.00015; // $0.15 per 1M tokens
    return (this.tokensUsed / 1000) * costPer1kTokens;
  }
}
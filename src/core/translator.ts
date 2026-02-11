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
Critical Rules:
1. Maintain the original tone and style
2. Do not translate technical terms that should remain in English (like brand names, unless specified in glossary)
3. For SEO elements (titles, meta descriptions), optimize for the target language's search patterns
4. Preserve any HTML entities or special characters exactly as they appear
5. Keep translations natural and culturally appropriate for ${targetLanguage}
6. IMPORTANT: Return a JSON object with a "translations" array containing translations IN THE EXACT SAME ORDER as the input array
7. The number of translations MUST equal the number of input texts`;

    const userPrompt = `Translate the following ${texts.length} texts to ${targetLanguage}.

CRITICAL: Return a JSON object with this EXACT structure:
{
  "translations": [
    "translation of text 0",
    "translation of text 1",
    "translation of text 2",
    ...
  ]
}

The "translations" array MUST contain exactly ${texts.length} items in the same order as the input.

Input texts (array of ${texts.length} items):
${JSON.stringify(texts, null, 2)}`;

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        // Calculate appropriate max_tokens: input length * 10 for safety margin
        const estimatedOutputTokens = Math.max(2000, texts.join('').length * 10);
        const maxTokens = Math.min(16000, estimatedOutputTokens);

        const response = await this.openai.chat.completions.create({
          model: this.config.openaiModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content || '';

        // Track token usage for cost estimation
        if (response.usage) {
          this.tokensUsed += response.usage.total_tokens;
        }

        // Parse JSON response with error handling
        let parsed: { translations: string[] };
        try {
          parsed = JSON.parse(content);

          // Validate response structure
          if (!parsed.translations || !Array.isArray(parsed.translations)) {
            throw new Error('Response missing "translations" array or translations is not an array');
          }

          // Validate array length
          if (parsed.translations.length !== texts.length) {
            console.warn(`Translation count mismatch: expected ${texts.length}, got ${parsed.translations.length}`);
            // Pad with original texts if needed
            while (parsed.translations.length < texts.length) {
              const missingIndex = parsed.translations.length;
              const originalText = texts[missingIndex] || '';
              parsed.translations.push(originalText);
              console.warn(`Added missing translation at index ${missingIndex}: ${originalText}`);
            }
          }
        } catch (parseError) {
          console.error('Failed to parse JSON response:', content);
          throw new Error(`Invalid JSON response from OpenAI API: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
        }

        // Create mapping using array index
        const result: Record<string, string> = {};
        texts.forEach((text, index) => {
          result[text] = parsed.translations[index] || text;
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
    const batchSize = 20; // Reduced batch size for better translation quality
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
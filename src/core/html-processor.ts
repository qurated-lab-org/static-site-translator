import * as cheerio from 'cheerio';
import { TranslatorConfig } from '../types';

export class HtmlProcessor {
  private config: TranslatorConfig;
  private placeholderMap: Map<string, string>;
  private placeholderIndex: number;

  constructor(config: TranslatorConfig) {
    this.config = config;
    this.placeholderMap = new Map();
    this.placeholderIndex = 0;
  }

  private createPlaceholder(content: string): string {
    const placeholder = `__SKIP_PLACEHOLDER_${this.placeholderIndex++}__`;
    this.placeholderMap.set(placeholder, content);
    return placeholder;
  }

  private restorePlaceholders(content: string): string {
    let result = content;
    for (const [placeholder, original] of this.placeholderMap.entries()) {
      result = result.replace(new RegExp(placeholder, 'g'), original);
    }
    return result;
  }

  async extractTranslatableContent(html: string): Promise<{
    translatable: string[];
    mapping: Map<string, string>;
    processedHtml: string;
  }> {
    const $ = cheerio.load(html);
    const translatable: string[] = [];
    const mapping = new Map<string, string>();

    // Reset for each HTML file
    this.placeholderMap.clear();
    this.placeholderIndex = 0;

    // Replace elements that should not be translated with placeholders
    if (this.config.safety?.preserveScripts !== false) {
      $('script').each((_, elem) => {
        const $elem = $(elem);
        const content = $elem.html() || '';
        const placeholder = this.createPlaceholder(`<script${this.getAttributes($elem)}>` + content + '</script>');
        $elem.replaceWith(placeholder);
      });
    }

    if (this.config.safety?.preserveStyles !== false) {
      $('style').each((_, elem) => {
        const $elem = $(elem);
        const content = $elem.html() || '';
        const placeholder = this.createPlaceholder(`<style${this.getAttributes($elem)}>` + content + '</style>');
        $elem.replaceWith(placeholder);
      });
    }

    if (this.config.safety?.preserveCodeBlocks !== false) {
      $('pre, code').each((_, elem) => {
        const $elem = $(elem);
        const tagName = elem.tagName.toLowerCase();
        const content = $elem.html() || '';
        const placeholder = this.createPlaceholder(`<${tagName}${this.getAttributes($elem)}>` + content + `</${tagName}>`);
        $elem.replaceWith(placeholder);
      });
    }

    // Extract translatable text from title
    const title = $('title').text();
    if (title) {
      const key = `__TITLE__`;
      translatable.push(title);
      mapping.set(key, title);
    }

    // Extract translatable text from meta description
    const metaDescription = $('meta[name="description"]').attr('content');
    if (metaDescription) {
      const key = `__META_DESC__`;
      translatable.push(metaDescription);
      mapping.set(key, metaDescription);
    }

    // Extract translatable text from meta keywords
    const metaKeywords = $('meta[name="keywords"]').attr('content');
    if (metaKeywords) {
      const key = `__META_KEYWORDS__`;
      translatable.push(metaKeywords);
      mapping.set(key, metaKeywords);
    }

    // Extract translatable text from alt attributes
    $('img[alt]').each((index, elem) => {
      const alt = $(elem).attr('alt');
      if (alt && alt.trim()) {
        const key = `__IMG_ALT_${index}__`;
        translatable.push(alt);
        mapping.set(key, alt);
      }
    });

    // Extract translatable text from title attributes
    $('[title]').each((index, elem) => {
      const titleAttr = $(elem).attr('title');
      if (titleAttr && titleAttr.trim()) {
        const key = `__TITLE_ATTR_${index}__`;
        translatable.push(titleAttr);
        mapping.set(key, titleAttr);
      }
    });

    // Extract translatable text from placeholder attributes
    $('[placeholder]').each((index, elem) => {
      const placeholder = $(elem).attr('placeholder');
      if (placeholder && placeholder.trim()) {
        const key = `__PLACEHOLDER_${index}__`;
        translatable.push(placeholder);
        mapping.set(key, placeholder);
      }
    });

    // Extract text nodes
    this.extractTextNodes($, $('body'), translatable, mapping);

    // Return processed HTML with placeholders
    const processedHtml = $.html();

    return { translatable, mapping, processedHtml };
  }

  private extractTextNodes(
    $: cheerio.CheerioAPI,
    element: cheerio.Cheerio<any>,
    translatable: string[],
    mapping: Map<string, string>
  ): void {
    element.contents().each((index, node) => {
      if (node.type === 'text') {
        const text = $(node).text();
        const trimmed = text.trim();
        if (trimmed && !trimmed.match(/^__SKIP_PLACEHOLDER_\d+__$/)) {
          const key = `__TEXT_${translatable.length}__`;
          translatable.push(trimmed);
          mapping.set(key, trimmed);
        }
      } else if (node.type === 'tag') {
        const $node = $(node);
        const tagName = node.name.toLowerCase();

        // Skip certain elements
        if (!['script', 'style', 'pre', 'code'].includes(tagName)) {
          this.extractTextNodes($, $node, translatable, mapping);
        }
      }
    });
  }

  async applyTranslations(
    processedHtml: string,
    translations: Record<string, string>,
    targetLanguage: string
  ): Promise<string> {
    const $ = cheerio.load(processedHtml);

    // Apply title translation
    if (translations['__TITLE__']) {
      $('title').text(translations['__TITLE__']);
    }

    // Apply meta description translation
    if (translations['__META_DESC__']) {
      $('meta[name="description"]').attr('content', translations['__META_DESC__']);
    }

    // Apply meta keywords translation
    if (translations['__META_KEYWORDS__']) {
      $('meta[name="keywords"]').attr('content', translations['__META_KEYWORDS__']);
    }

    // Apply alt attribute translations
    $('img[alt]').each((index, elem) => {
      const key = `__IMG_ALT_${index}__`;
      if (translations[key]) {
        $(elem).attr('alt', translations[key]);
      }
    });

    // Apply title attribute translations
    $('[title]').each((index, elem) => {
      const key = `__TITLE_ATTR_${index}__`;
      if (translations[key]) {
        $(elem).attr('title', translations[key]);
      }
    });

    // Apply placeholder attribute translations
    $('[placeholder]').each((index, elem) => {
      const key = `__PLACEHOLDER_${index}__`;
      if (translations[key]) {
        $(elem).attr('placeholder', translations[key]);
      }
    });

    // Apply text node translations
    let textIndex = 0;
    this.replaceTextNodes($, $('body'), translations, textIndex);

    // Add hreflang tags if enabled
    if (this.config.seo?.injectHreflang !== false) {
      this.injectHreflangTags($, targetLanguage);
    }

    // Add language attribute to html tag
    $('html').attr('lang', targetLanguage);

    let result = $.html();

    // Restore placeholders
    result = this.restorePlaceholders(result);

    return result;
  }

  private replaceTextNodes(
    $: cheerio.CheerioAPI,
    element: cheerio.Cheerio<any>,
    translations: Record<string, string>,
    textIndex: number
  ): number {
    element.contents().each((_, node) => {
      if (node.type === 'text') {
        const text = $(node).text();
        const trimmed = text.trim();
        if (trimmed && !trimmed.match(/^__SKIP_PLACEHOLDER_\d+__$/)) {
          const key = `__TEXT_${textIndex}__`;
          if (translations[key]) {
            // Preserve original whitespace
            const leadingSpace = text.match(/^\s*/)?.[0] || '';
            const trailingSpace = text.match(/\s*$/)?.[0] || '';
            $(node).replaceWith(leadingSpace + translations[key] + trailingSpace);
          }
          textIndex++;
        }
      } else if (node.type === 'tag') {
        const tagName = node.name.toLowerCase();
        if (!['script', 'style', 'pre', 'code'].includes(tagName)) {
          textIndex = this.replaceTextNodes($, $(node), translations, textIndex);
        }
      }
    });
    return textIndex;
  }

  private injectHreflangTags($: cheerio.CheerioAPI, currentLanguage: string): void {
    // Remove existing hreflang tags
    $('link[rel="alternate"][hreflang]').remove();

    // Add hreflang tags for all configured languages
    const languages = [
      ...this.config.targetLanguages,
      this.getSourceLanguage(),
    ].filter((lang, index, self) => self.indexOf(lang) === index);

    languages.forEach(lang => {
      const hreflang = lang === currentLanguage ? 'x-default' : lang;
      $('head').append(`<link rel="alternate" hreflang="${hreflang}" href="/${lang}/" />\n`);
    });
  }

  private getSourceLanguage(): string {
    // Try to detect from existing HTML or default to 'en'
    return 'en';
  }

  private getAttributes($elem: cheerio.Cheerio<any>): string {
    const attrs = $elem.attr();
    if (!attrs || Object.keys(attrs).length === 0) {
      return '';
    }

    return ' ' + Object.entries(attrs)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
  }
}
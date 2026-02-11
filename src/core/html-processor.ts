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
    const $ = cheerio.load(html, { decodeEntities: false } as any);
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

    // Extract translatable text from Open Graph meta tags
    const ogTitle = $('meta[property="og:title"]').attr('content');
    if (ogTitle) {
      const key = `__OG_TITLE__`;
      translatable.push(ogTitle);
      mapping.set(key, ogTitle);
    }

    const ogDescription = $('meta[property="og:description"]').attr('content');
    if (ogDescription) {
      const key = `__OG_DESC__`;
      translatable.push(ogDescription);
      mapping.set(key, ogDescription);
    }

    const ogSiteName = $('meta[property="og:site_name"]').attr('content');
    if (ogSiteName) {
      const key = `__OG_SITE_NAME__`;
      translatable.push(ogSiteName);
      mapping.set(key, ogSiteName);
    }

    const ogImageAlt = $('meta[property="og:image:alt"]').attr('content');
    if (ogImageAlt) {
      const key = `__OG_IMAGE_ALT__`;
      translatable.push(ogImageAlt);
      mapping.set(key, ogImageAlt);
    }

    // Extract translatable text from Twitter Card meta tags
    const twitterTitle = $('meta[name="twitter:title"]').attr('content');
    if (twitterTitle) {
      const key = `__TWITTER_TITLE__`;
      translatable.push(twitterTitle);
      mapping.set(key, twitterTitle);
    }

    const twitterDescription = $('meta[name="twitter:description"]').attr('content');
    if (twitterDescription) {
      const key = `__TWITTER_DESC__`;
      translatable.push(twitterDescription);
      mapping.set(key, twitterDescription);
    }

    const twitterImageAlt = $('meta[name="twitter:image:alt"]').attr('content');
    if (twitterImageAlt) {
      const key = `__TWITTER_IMAGE_ALT__`;
      translatable.push(twitterImageAlt);
      mapping.set(key, twitterImageAlt);
    }

    // Extract translatable text from JSON-LD structured data
    $('script[type="application/ld+json"]').each((index, elem) => {
      const $elem = $(elem);
      const jsonContent = $elem.html();
      if (jsonContent) {
        try {
          const jsonData = JSON.parse(jsonContent);
          const key = `__JSON_LD_${index}__`;
          translatable.push(JSON.stringify(jsonData));
          mapping.set(key, jsonContent);
        } catch (e) {
          // Skip invalid JSON
        }
      }
    });

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

    // Extract block-level elements with their innerHTML (NEW APPROACH)
    this.extractBlockElements($, $('body'), translatable, mapping);

    // Return processed HTML with placeholders
    const processedHtml = $.html();

    return { translatable, mapping, processedHtml };
  }

  private extractBlockElements(
    $: cheerio.CheerioAPI,
    element: cheerio.Cheerio<any>,
    translatable: string[],
    mapping: Map<string, string>
  ): void {
    // Block-level elements that should be translated as a whole
    const blockElements = [
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'li', 'td', 'th', 'dt', 'dd',
      'blockquote', 'figcaption', 'caption',
      'label', 'legend', 'summary'
    ];

    const blockSelector = blockElements.join(',');

    element.find(blockSelector).each((index, elem) => {
      const $elem = $(elem);

      // Skip if this element is already marked (avoid duplicates)
      if ($elem.attr('data-translate-key')) {
        return;
      }

      // Skip if this element contains block children (to avoid duplicates with nested blocks)
      const hasBlockChildren = $elem.find(blockSelector).length > 0;
      if (hasBlockChildren) {
        return;
      }

      const innerHTML = $elem.html();
      if (!innerHTML) return;

      // Check if this element has meaningful text content
      const textContent = $elem.text().trim();
      if (!textContent || textContent.match(/^__SKIP_PLACEHOLDER_\d+__$/)) {
        return;
      }

      // Check if this element contains only placeholder (skip it)
      if (innerHTML.match(/^__SKIP_PLACEHOLDER_\d+__$/)) {
        return;
      }

      // Generate unique key for this block
      const key = `__BLOCK_${translatable.length}__`;
      translatable.push(innerHTML);
      mapping.set(key, innerHTML);

      // Mark this element with data attribute for later replacement
      $elem.attr('data-translate-key', key);
    });
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
    const $ = cheerio.load(processedHtml, { decodeEntities: false } as any);

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

    // Apply Open Graph meta tag translations
    if (translations['__OG_TITLE__']) {
      $('meta[property="og:title"]').attr('content', translations['__OG_TITLE__']);
    }

    if (translations['__OG_DESC__']) {
      $('meta[property="og:description"]').attr('content', translations['__OG_DESC__']);
    }

    if (translations['__OG_SITE_NAME__']) {
      $('meta[property="og:site_name"]').attr('content', translations['__OG_SITE_NAME__']);
    }

    if (translations['__OG_IMAGE_ALT__']) {
      $('meta[property="og:image:alt"]').attr('content', translations['__OG_IMAGE_ALT__']);
    }

    // Apply Twitter Card meta tag translations
    if (translations['__TWITTER_TITLE__']) {
      $('meta[name="twitter:title"]').attr('content', translations['__TWITTER_TITLE__']);
    }

    if (translations['__TWITTER_DESC__']) {
      $('meta[name="twitter:description"]').attr('content', translations['__TWITTER_DESC__']);
    }

    if (translations['__TWITTER_IMAGE_ALT__']) {
      $('meta[name="twitter:image:alt"]').attr('content', translations['__TWITTER_IMAGE_ALT__']);
    }

    // Apply JSON-LD structured data translations
    $('script[type="application/ld+json"]').each((index, elem) => {
      const key = `__JSON_LD_${index}__`;
      if (translations[key]) {
        try {
          // Parse the translated JSON string and re-stringify with proper formatting
          const translatedData = JSON.parse(translations[key]);
          $(elem).html(JSON.stringify(translatedData));
        } catch (e) {
          // Skip if translation resulted in invalid JSON
        }
      }
    });

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

    // Apply block-level element translations (NEW APPROACH)
    this.applyBlockTranslations($, translations);

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

  private applyBlockTranslations(
    $: cheerio.CheerioAPI,
    translations: Record<string, string>
  ): void {
    // Find all elements marked with data-translate-key
    $('[data-translate-key]').each((_, elem) => {
      const $elem = $(elem);
      const key = $elem.attr('data-translate-key');

      if (key && translations[key]) {
        // Replace innerHTML with translated HTML
        $elem.html(translations[key]);
        // Remove the data attribute after translation
        $elem.removeAttr('data-translate-key');
      }
    });
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

    const baseUrl = this.config.seo?.baseUrl;

    // Warn if baseUrl is not configured
    if (!baseUrl) {
      console.warn('⚠️  seo.baseUrl is not configured. Hreflang tags will use relative paths, which may not be ideal for SEO.');
    }

    // Add hreflang tags for all configured languages
    const languages = [
      ...this.config.targetLanguages,
      this.getSourceLanguage(),
    ].filter((lang, index, self) => self.indexOf(lang) === index);

    languages.forEach(lang => {
      const hreflang = lang === currentLanguage ? 'x-default' : lang;

      // Generate absolute or relative URL
      const href = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/${lang}/`
        : `/${lang}/`;

      $('head').append(`<link rel="alternate" hreflang="${hreflang}" href="${href}" />\n`);
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
import * as cheerio from 'cheerio';
import { TranslatorConfig } from '../types';

export class HtmlProcessor {
  private config: TranslatorConfig;
  private placeholderMap: Map<string, string>;
  private placeholderIndex: number;
  // RSC payload strings to translate: key -> original text
  private rscStrings: Map<string, string>;
  // Dynamic translation texts: original -> key
  private dynamicTexts: Map<string, string>;

  constructor(config: TranslatorConfig) {
    this.config = config;
    this.placeholderMap = new Map();
    this.placeholderIndex = 0;
    this.rscStrings = new Map();
    this.dynamicTexts = new Map();
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

  // CJK文字（日本語・中国語・韓国語）を含む文字列かどうかを判定
  private hasCjk(text: string): boolean {
    return /[\u3000-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/.test(text);
  }

  // 値を再帰的に走査してCJK文字列を収集する
  private collectCjkStrings(value: unknown, result: Set<string>): void {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 1 && this.hasCjk(trimmed)) {
        result.add(trimmed);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        this.collectCjkStrings(item, result);
      }
    } else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) {
        this.collectCjkStrings(v, result);
      }
    }
  }

  // Extract translatable text strings from Next.js RSC payload scripts
  // RSCペイロードの形式: self.__next_f.push([type, data])
  // type=1: dataはRSCフライトデータ文字列（行ごとに "id:json\n" の形式）
  // type=0や他: dataはJSONオブジェクト
  private extractRscPayloadStrings(
    $: cheerio.CheerioAPI,
    translatable: string[],
    mapping: Map<string, string>
  ): void {
    $('script[data-rsc-payload]').each((scriptIndex, elem) => {
      const content = $(elem).html() || '';
      const cjkStrings = new Set<string>();

      // self.__next_f.push([type, data]) の引数部分を抽出
      // self.__next_f.push([...]) の引数を抽出（最後の ) まで greedy でマッチ）
      const pushMatch = content.match(/self\.__next_f\.push\(([\s\S]*)\)\s*$/);
      if (!pushMatch) return;

      let args: unknown;
      try {
        args = JSON.parse(pushMatch[1] ?? '');
      } catch {
        return;
      }

      if (!Array.isArray(args) || args.length < 2) return;

      const type = args[0];
      const data = args[1];

      if (type === 1 && typeof data === 'string') {
        // RSCフライトデータ文字列: 各行が "id:json\n" の形式
        // 各行をパースしてJSONオブジェクト内のCJK文字列を収集
        const lines = data.split('\n');
        for (const line of lines) {
          // "id:json" の形式
          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) continue;
          const jsonPart = line.slice(colonIdx + 1).trim();
          if (!jsonPart || !this.hasCjk(jsonPart)) continue;

          try {
            const parsed = JSON.parse(jsonPart);
            this.collectCjkStrings(parsed, cjkStrings);
          } catch {
            // JSONでない場合は文字列そのものをチェック
            if (this.hasCjk(jsonPart)) {
              cjkStrings.add(jsonPart.trim());
            }
          }
        }
      } else {
        // type=0など: data自体がJSON値
        this.collectCjkStrings(data, cjkStrings);
      }

      // 収集した文字列を翻訳リストに追加
      let i = 0;
      for (const text of cjkStrings) {
        if (!this.rscStrings.has(text)) {
          const key = `__RSC_STR_${scriptIndex}_${i}__`;
          this.rscStrings.set(text, key);
          translatable.push(text);
          mapping.set(key, text);
          i++;
        }
      }
    });
  }

  // data-translate-dynamic属性を持つ要素のテキストを収集する
  private extractDynamicTranslations(
    $: cheerio.CheerioAPI,
    translatable: string[],
    mapping: Map<string, string>
  ): void {
    $('[data-translate-dynamic]').each((index, elem) => {
      const text = $(elem).text().trim();
      if (!text || this.dynamicTexts.has(text)) return;
      const key = `__DYNAMIC_${index}__`;
      this.dynamicTexts.set(text, key);
      translatable.push(text);
      mapping.set(key, text);
    });
  }

  // data-no-translate属性を持つ要素をプレースホルダーに置換する
  private protectNoTranslateElements($: cheerio.CheerioAPI): void {
    $('[data-no-translate]').each((_, elem) => {
      const $elem = $(elem);
      const outerHtml = $.html($elem);
      const placeholder = this.createPlaceholder(outerHtml);
      $elem.replaceWith(placeholder);
    });
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
    this.rscStrings.clear();
    this.dynamicTexts.clear();

    // Replace elements that should not be translated with placeholders
    // Note: Next.js RSC payload scripts (self.__next_f.push) are handled separately
    if (this.config.safety?.preserveScripts !== false) {
      $('script').each((_, elem) => {
        const $elem = $(elem);
        const content = $elem.html() || '';
        // RSC payload scripts need special handling - mark them but don't protect yet
        if (content.includes('self.__next_f.push')) {
          $elem.attr('data-rsc-payload', 'true');
          return; // skip placeholder for now
        }
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

    // Protect elements marked with data-no-translate attribute
    this.protectNoTranslateElements($);

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
      const $elem = $(elem);
      const alt = $elem.attr('alt');
      if (alt && alt.trim()) {
        const key = `__IMG_ALT_${index}__`;
        translatable.push(alt);
        mapping.set(key, alt);
        $elem.attr('data-alt-key', key);
      }
    });

    // Extract translatable text from title attributes
    $('[title]').each((index, elem) => {
      const $elem = $(elem);
      const titleAttr = $elem.attr('title');
      if (titleAttr && titleAttr.trim()) {
        const key = `__TITLE_ATTR_${index}__`;
        translatable.push(titleAttr);
        mapping.set(key, titleAttr);
        $elem.attr('data-title-key', key);
      }
    });

    // Extract translatable text from placeholder attributes
    $('[placeholder]').each((index, elem) => {
      const $elem = $(elem);
      const placeholder = $elem.attr('placeholder');
      if (placeholder && placeholder.trim()) {
        const key = `__PLACEHOLDER_KEY_${index}__`;
        translatable.push(placeholder);
        mapping.set(key, placeholder);
        $elem.attr('data-placeholder-key', key);
      }
    });

    // Extract block-level elements with their innerHTML (NEW APPROACH)
    this.extractBlockElements($, $('body'), translatable, mapping);

    // Extract text strings from Next.js RSC payload scripts
    this.extractRscPayloadStrings($, translatable, mapping);

    // Extract texts from data-translate-dynamic elements for runtime translation map
    this.extractDynamicTranslations($, translatable, mapping);

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
      'label', 'legend', 'summary',
      'button',
    ];

    const blockSelector = blockElements.join(',');

    // Also translate elements explicitly marked with data-translate attribute
    element.find('[data-translate]').each((index, elem) => {
      const $elem = $(elem);
      if ($elem.attr('data-translate-key')) return;
      const innerHTML = $elem.html();
      if (!innerHTML) return;
      const textContent = $elem.text().trim();
      if (!textContent || textContent.match(/^__SKIP_PLACEHOLDER_\d+__$/)) return;
      if (innerHTML.match(/^__SKIP_PLACEHOLDER_\d+__$/)) return;
      const key = `__BLOCK_${translatable.length}__`;
      translatable.push(innerHTML);
      mapping.set(key, innerHTML);
      $elem.attr('data-translate-key', key);
    });

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

    // Also translate standalone <a> elements that are not already inside a block element
    // (e.g. CTA buttons like <a class="btn-tour-apply">ツアーを申し込む</a>)
    element.find('a').each((index, elem) => {
      const $elem = $(elem);

      // Skip if already marked
      if ($elem.attr('data-translate-key')) return;

      // Skip if inside a block element (already covered above)
      if ($elem.closest(blockSelector).length > 0) return;

      const innerHTML = $elem.html();
      if (!innerHTML) return;

      const textContent = $elem.text().trim();
      if (!textContent || textContent.match(/^__SKIP_PLACEHOLDER_\d+__$/)) return;
      if (innerHTML.match(/^__SKIP_PLACEHOLDER_\d+__$/)) return;

      const key = `__BLOCK_${translatable.length}__`;
      translatable.push(innerHTML);
      mapping.set(key, innerHTML);
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
    $('img[data-alt-key]').each((_, elem) => {
      const $elem = $(elem);
      const key = $elem.attr('data-alt-key');
      if (key && translations[key]) {
        $elem.attr('alt', translations[key]);
      }
      $elem.removeAttr('data-alt-key');
    });

    // Apply title attribute translations
    $('[data-title-key]').each((_, elem) => {
      const $elem = $(elem);
      const key = $elem.attr('data-title-key');
      if (key && translations[key]) {
        $elem.attr('title', translations[key]);
      }
      $elem.removeAttr('data-title-key');
    });

    // Apply placeholder attribute translations
    $('[data-placeholder-key]').each((_, elem) => {
      const $elem = $(elem);
      const key = $elem.attr('data-placeholder-key');
      if (key && translations[key]) {
        $elem.attr('placeholder', translations[key]);
      }
      $elem.removeAttr('data-placeholder-key');
    });

    // Apply block-level element translations (NEW APPROACH)
    this.applyBlockTranslations($, translations);

    // Apply translations to Next.js RSC payload scripts
    this.applyRscPayloadTranslations($, translations);

    // Inject dynamic translations map for runtime use
    this.injectDynamicTranslationsScript($, translations);

    // Rewrite internal links for non-Japanese pages (e.g. /spots/ -> /en/spots/)
    if (targetLanguage !== 'ja') {
      this.rewriteInternalLinks($, targetLanguage);
    }

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
      }
      // Remove the data attributes after translation
      $elem.removeAttr('data-translate-key');
      $elem.removeAttr('data-translate');
    });
  }

  // 値を再帰的に走査して翻訳を適用する
  private translateValue(value: unknown, translations: Record<string, string>): unknown {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      // rscStringsのmapからkeyを逆引きして翻訳を取得
      const key = this.rscStrings.get(trimmed);
      if (key && translations[key] && translations[key] !== trimmed) {
        // 前後の空白を保持しつつ翻訳を適用
        return value.replace(trimmed, translations[key]);
      }
      return value;
    } else if (Array.isArray(value)) {
      return value.map(item => this.translateValue(item, translations));
    } else if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = this.translateValue(v, translations);
      }
      return result;
    }
    return value;
  }

  private applyRscPayloadTranslations(
    $: cheerio.CheerioAPI,
    translations: Record<string, string>
  ): void {
    // 翻訳対象の文字列がなければ属性だけ除去してスキップ
    if (this.rscStrings.size === 0) {
      $('script[data-rsc-payload]').each((_, elem) => {
        $(elem).removeAttr('data-rsc-payload');
      });
      return;
    }

    // すべてのRSCスクリプトを配列で取得（順序が重要）
    const rscElems: any[] = [];
    $('script[data-rsc-payload]').each((_, elem) => {
      rscElems.push(elem);
    });

    // Tプレフィックスで参照されるデータスクリプトの新しいバイト長を記録するmap
    // key: データID (例: "12"), value: 翻訳後のバイト長
    const updatedBlobSizes = new Map<string, number>();

    // まず各スクリプトの翻訳を行い、Tプレフィックス参照のデータサイズを収集
    const translatedContents = new Map<number, string>();

    for (let i = 0; i < rscElems.length; i++) {
      const $elem = $(rscElems[i]);
      const content = $elem.html() || '';

      const pushMatch = content.match(/self\.__next_f\.push\(([\s\S]*)\)\s*$/);
      if (!pushMatch) continue;

      let args: unknown;
      try {
        args = JSON.parse(pushMatch[1] ?? '');
      } catch {
        continue;
      }

      if (!Array.isArray(args) || args.length < 2) continue;

      const type = args[0];
      const data = args[1];

      if (type !== 1 || typeof data !== 'string') {
        // type=0など: data全体を翻訳
        const translated = this.translateValue(data, translations);
        translatedContents.set(i, `self.__next_f.push(${JSON.stringify([type, translated])})`);
        continue;
      }

      // RSCフライトデータ: 各行をパース→翻訳→再シリアライズ
      const lines = data.split('\n');
      const translatedLines = lines.map(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) return line;
        const id = line.slice(0, colonIdx);
        const rest = line.slice(colonIdx + 1);

        // Tプレフィックス行: バイナリブロブのサイズ指定（後で更新）
        if (rest.startsWith('T')) {
          // "Thex,..." の形式 - このラウンドではそのまま残し、後で更新
          return line;
        }

        const jsonPart = rest.trim();
        if (!jsonPart || !this.hasCjk(jsonPart)) return line;

        try {
          const parsed = JSON.parse(jsonPart);
          const translated = this.translateValue(parsed, translations);
          return `${id}:${JSON.stringify(translated)}`;
        } catch {
          // JSONでない行はそのまま文字列置換
          let result = jsonPart;
          for (const [originalText, key] of this.rscStrings.entries()) {
            const tr = translations[key];
            if (tr && tr !== originalText) {
              result = result.split(originalText).join(tr);
            }
          }
          return `${id}:${result}`;
        }
      });

      const translatedData = translatedLines.join('\n');

      // このスクリプトがTプレフィックス行を含む場合、対応するデータIDを記録
      for (const line of translatedLines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const id = line.slice(0, colonIdx);
        const rest = line.slice(colonIdx + 1);
        if (rest.startsWith('T')) {
          // "Thex,..." の形式からIDを抽出
          const hexMatch = rest.match(/^T([0-9a-fA-F]+),/);
          if (hexMatch) {
            // このIDのデータは別スクリプトに含まれる - 後で更新が必要
            updatedBlobSizes.set(id, -1); // プレースホルダー
          }
        }
      }

      translatedContents.set(i, `self.__next_f.push(${JSON.stringify([type, translatedData])})`);
    }

    // Tプレフィックスで参照される「生データスクリプト」のバイト長を計算して更新
    // 生データスクリプトは単一の文字列データを持ち、"id:json" 形式の行を含まないもの
    for (let i = 0; i < rscElems.length; i++) {
      const $elem = $(rscElems[i]);
      const content = $elem.html() || '';

      const pushMatch = content.match(/self\.__next_f\.push\(([\s\S]*)\)\s*$/);
      if (!pushMatch) continue;

      let args: unknown;
      try {
        args = JSON.parse(pushMatch[1] ?? '');
      } catch {
        continue;
      }

      if (!Array.isArray(args) || args.length < 2) continue;
      if (args[0] !== 1 || typeof args[1] !== 'string') continue;

      const data = args[1] as string;
      // "id:content" 形式の行を含まず、単一の生コンテンツ（HTMLなど）の場合
      const isRawContent = !data.split('\n').some(l => {
        const col = l.indexOf(':');
        if (col === -1) return false;
        const id = l.slice(0, col);
        return /^\w+$/.test(id);
      });

      if (!isRawContent) continue;

      // このスクリプトは生データ - 翻訳してバイト長を計算
      let translatedData = data;
      if (this.hasCjk(data)) {
        for (const [originalText, key] of this.rscStrings.entries()) {
          const tr = translations[key];
          if (tr && tr !== originalText) {
            translatedData = translatedData.split(originalText).join(tr);
          }
        }
      }

      const newByteLen = Buffer.byteLength(translatedData, 'utf8');
      translatedContents.set(i, `self.__next_f.push(${JSON.stringify([1, translatedData])})`);

      // 前のスクリプトのTプレフィックス行を更新する必要がある
      // Tプレフィックスで参照されるIDを特定するために前のスクリプトを調べる
      // 生データの前のスクリプトのTプレフィックスを更新
      for (let j = i - 1; j >= 0; j--) {
        const prevContent = translatedContents.get(j);
        if (!prevContent) continue;

        // このスクリプトがTプレフィックスを持つ行を含むか確認
        const prevPushMatch = prevContent.match(/self\.__next_f\.push\(([\s\S]*)\)\s*$/);
        if (!prevPushMatch) continue;

        let prevArgs: unknown;
        try {
          prevArgs = JSON.parse(prevPushMatch[1] ?? '');
        } catch {
          continue;
        }

        if (!Array.isArray(prevArgs) || prevArgs.length < 2) continue;
        if (prevArgs[0] !== 1 || typeof prevArgs[1] !== 'string') continue;

        const prevData = prevArgs[1] as string;
        let updated = false;
        const updatedLines = prevData.split('\n').map(line => {
          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) return line;
          const id = line.slice(0, colonIdx);
          const rest = line.slice(colonIdx + 1);
          if (!rest.startsWith('T')) return line;

          const hexMatch = rest.match(/^T([0-9a-fA-F]+),(.*)/);
          if (!hexMatch) return line;

          const oldSize = parseInt(hexMatch[1] ?? '0', 16);
          // 元のデータのバイト長と比較
          const originalByteLen = Buffer.byteLength(data, 'utf8');
          if (oldSize === originalByteLen) {
            // このTプレフィックスが今の生データを参照している
            const newHex = newByteLen.toString(16);
            updated = true;
            return `${id}:T${newHex},${hexMatch[2]}`;
          }
          return line;
        });

        if (updated) {
          const newPrevData = updatedLines.join('\n');
          translatedContents.set(j, `self.__next_f.push(${JSON.stringify([1, newPrevData])})`);
          break;
        }
      }
    }

    // すべての翻訳済みコンテンツを適用
    for (let i = 0; i < rscElems.length; i++) {
      const $elem = $(rscElems[i]);
      $elem.removeAttr('data-rsc-payload');
      const newContent = translatedContents.get(i);
      if (newContent) {
        $elem.html(newContent);
      }
    }
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

  private injectDynamicTranslationsScript(
    $: cheerio.CheerioAPI,
    translations: Record<string, string>
  ): void {
    if (this.dynamicTexts.size === 0) return;

    const map: Record<string, string> = {};
    for (const [originalText, key] of this.dynamicTexts.entries()) {
      const translated = translations[key];
      if (translated && translated !== originalText) {
        map[originalText] = translated;
      }
    }

    if (Object.keys(map).length === 0) return;

    const script = `<script id="__dynamic_translations__">window.__dynamicTranslations=window.__dynamicTranslations||{};Object.assign(window.__dynamicTranslations,${JSON.stringify(map)});</script>`;
    $('body').append(script);
  }

  private rewriteInternalLinks($: cheerio.CheerioAPI, targetLanguage: string): void {
    const prefix = `/${targetLanguage}`;

    // Rewrite href attributes on <a> tags
    $('a[href]').each((_, elem) => {
      const $elem = $(elem);
      const href = $elem.attr('href') || '';

      // Only rewrite absolute internal paths (starting with /) that don't already have the prefix
      if (
        href.startsWith('/') &&
        !href.startsWith(`/${targetLanguage}/`) &&
        href !== `/${targetLanguage}` &&
        !href.startsWith('//') &&
        !href.startsWith('/assets/') &&
        !href.startsWith('/favicon')
      ) {
        $elem.attr('href', prefix + (href === '/' ? '/' : href));
      }
    });

    // Rewrite og:url meta tag
    const ogUrl = $('meta[property="og:url"]').attr('content');
    if (ogUrl) {
      try {
        const url = new URL(ogUrl);
        if (!url.pathname.startsWith(prefix)) {
          url.pathname = prefix + url.pathname;
          $('meta[property="og:url"]').attr('content', url.toString());
        }
      } catch {
        // skip invalid URLs
      }
    }
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
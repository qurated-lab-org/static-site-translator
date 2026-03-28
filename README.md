# AI Static Translator

[![npm version](https://img.shields.io/npm/v/ai-static-translator.svg)](https://www.npmjs.com/package/ai-static-translator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg)](https://pnpm.io/)

Smart multi-language translator for static sites powered by OpenAI. Translate your entire static website to multiple languages in minutes with intelligent content preservation and SEO optimization.

## Features

- **3-Minute Setup**: Interactive wizard for instant configuration
- **Safety First**: Preserves code blocks, scripts, and styles perfectly
- **Cost-Efficient**: Smart caching system to minimize API costs
- **SEO Optimized**: Automatic hreflang tags and localized meta tags
- **Glossary Support**: Consistent translations for brand terms
- **Parallel Processing**: Fast translation with configurable concurrency
- **Dry Run Mode**: Preview operations without API calls
- **Detailed Reports**: Track translation progress and costs

## Installation

This package requires **pnpm** for development. For usage, you can run it directly with `npx`:

```bash
# Run directly without installation (recommended)
npx ai-static-translator init

# Or install globally with pnpm
pnpm add -g ai-static-translator

# Or install globally with npm
npm install -g ai-static-translator
```

## Quick Start

### 1. Initialize Configuration

Run the interactive setup wizard:

```bash
npx ai-static-translator init
```

The wizard will guide you through:
- Setting up source and output directories
- Configuring target languages
- Adding your OpenAI API key
- Optional glossary setup

### 2. Start Translation

After configuration, translate your site:

```bash
npx ai-static-translator translate

# Or with options
npx ai-static-translator translate --dry-run  # Preview without translating
npx ai-static-translator translate --verbose  # Show detailed output
npx ai-static-translator translate --clear-cache  # Clear cache before translating
```

## Configuration

The `translator.config.json` file supports these options:

```json
{
  "sourceDir": "./dist",
  "outputDir": "./dist-i18n",
  "targetLanguages": ["es", "fr", "de", "ja"],
  "openaiModel": "gpt-4o-mini",
  "glossary": {
    "es": {
      "Acme Corp": "Acme Corp",
      "Dashboard": "Panel de Control"
    }
  },
  "cache": {
    "enabled": true,
    "directory": ".translator-cache"
  },
  "parallel": {
    "limit": 5
  },
  "seo": {
    "injectHreflang": true,
    "localizeMetaTags": true
  },
  "safety": {
    "preserveCodeBlocks": true,
    "preserveScripts": true,
    "preserveStyles": true
  }
}
```

## API Key Configuration

Set your OpenAI API key in one of these ways:

1. **During setup**: The wizard will save it to `.env`
2. **Environment variable**: `export OPENAI_API_KEY=sk-...`
3. **In config file**: Add `"openaiApiKey": "sk-..."` (not recommended)

## Advanced Usage

### Glossary Management

Create consistent translations for specific terms:

```json
{
  "glossary": {
    "ja": {
      "Sign Up": "登録",
      "Log In": "ログイン",
      "Acme Corp": "Acme Corp"
    }
  }
}
```

### Ignore Patterns

Exclude specific files or directories:

```json
{
  "ignorePaths": [
    "**/admin/**",
    "**/test/**",
    "**/*.min.html"
  ]
}
```

### Custom Model Selection

Use different OpenAI models for quality/cost balance:

```json
{
  "openaiModel": "gpt-4o"
}
```

## Tips for Best Results

1. **Structure Your HTML Properly**: Well-structured HTML with semantic tags produces better translations
2. **Use the Cache**: Keep the cache enabled to avoid retranslating unchanged content
3. **Test with Dry Run**: Always test with `--dry-run` first to estimate costs
4. **Set Up Glossary**: Define important terms upfront for consistency
5. **Monitor Costs**: Check the translation report for token usage and costs

## Development

This project uses **pnpm** as the package manager:

```bash
# Clone the repository
git clone https://github.com/qurated-lab-org/static-site-translator.git
cd static-site-translator

# Install dependencies (pnpm required)
pnpm install

# Build the project
pnpm run build

# Run in development mode
pnpm run dev
```

## Example Output

After translation, your file structure will look like:

```
dist-i18n/
├── es/
│   ├── index.html
│   ├── about.html
│   └── products.html
├── fr/
│   ├── index.html
│   ├── about.html
│   └── products.html
├── de/
│   └── ...
└── translation-report.json
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. Make sure to:

1. Use pnpm for dependency management
2. Follow the existing code style
3. Add tests for new features
4. Update documentation as needed

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Commander.js](https://github.com/tj/commander.js) for CLI
- Powered by [OpenAI API](https://openai.com/) for translations
- Uses [Cheerio](https://cheerio.js.org/) for HTML parsing

## Troubleshooting

### pnpm not found
This project requires pnpm. Install it with:
```bash
npm install -g pnpm
```

### API Key Issues
Ensure your OpenAI API key:
- Starts with `sk-`
- Has sufficient credits
- Has access to your chosen model

### Translation Quality
- Use glossary for consistent brand terms
- Choose `gpt-4o` for higher quality (higher cost)
- Review and adjust translations as needed

## Support

- [Report Issues](https://github.com/qurated-lab-org/static-site-translator/issues)
- [Discussions](https://github.com/qurated-lab-org/static-site-translator/discussions)
- Contact: info@quratedlab.com

---

Made by [Qurated Lab](https://github.com/qurated-lab-org)

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
AI Static Translator - A smart multi-language translator CLI tool for static sites powered by OpenAI.

## Package Manager
**IMPORTANT**: This project strictly uses `pnpm`. The `package.json` includes a preinstall script to enforce this.

## Key Commands
```bash
# Install dependencies (pnpm required)
pnpm install

# Build TypeScript to JavaScript
pnpm run build

# Development mode with watch
pnpm run dev

# Run CLI commands
node dist/cli.js init       # Initialize configuration
node dist/cli.js translate  # Run translation
node dist/cli.js --help    # Show help

# Test locally without installation
npm link  # Create global symlink
ai-static-translator init  # Test as if installed globally
```

## Architecture

### Core Components
1. **HTML Processor (`src/core/html-processor.ts`)**
   - Most critical component - handles HTML parsing with Cheerio
   - Implements placeholder system to protect code/script/style blocks
   - Must preserve HTML structure perfectly

2. **Translator (`src/core/translator.ts`)**
   - OpenAI API integration
   - Batch processing with token tracking
   - Glossary and context-aware translation

3. **Cache Manager (`src/utils/cache.ts`)**
   - MD5 hash-based change detection
   - JSON file cache storage
   - Cost optimization through caching

### Safety Mechanisms
- Placeholder replacement for non-translatable content
- Preservation of code blocks, scripts, and styles
- HTML structure integrity validation

## Important Considerations
1. **CommonJS Compatibility**: Use older versions of ESM-only packages (chalk@4, ora@5, boxen@5, inquirer@8, p-limit@3)
2. **HTML Processing**: The HTML processor is error-prone - always test with complex HTML structures
3. **API Cost Management**: Cache system and batch processing are critical for cost control
4. **SEO Features**: Automatic hreflang tags and meta tag localization
5. **Error Handling**: Graceful degradation - continue processing even if individual files fail

## Testing Checklist
- [ ] Init command creates valid configuration
- [ ] Translate command preserves HTML structure
- [ ] Code blocks remain untranslated
- [ ] Cache system prevents redundant API calls
- [ ] Dry run mode shows accurate estimates
- [ ] Glossary terms are consistently translated
- [ ] hreflang tags are properly injected
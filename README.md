```

    :::       ::: ::::::::::: ::::    ::: :::::::::  :::::::::  ::::::::::: ::::::::: 
   :+:       :+:     :+:     :+:+:   :+: :+:    :+: :+:    :+:     :+:     :+:    :+: 
  +:+       +:+     +:+     :+:+:+  +:+ +:+    +:+ +:+    +:+     +:+     +:+    +:+  
 +#+  +:+  +#+     +#+     +#+ +:+ +#+ +#+    +:+ +#++:++#:      +#+     +#++:++#+    
+#+ +#+#+ +#+     +#+     +#+  +#+#+# +#+    +#+ +#+    +#+     +#+     +#+           
#+#+# #+#+#      #+#     #+#   #+#+# #+#    #+# #+#    #+#     #+#     #+#            
###   ###   ########### ###    #### #########  ###    ### ########### ###             
           
```

# 🌬️ Windrip

**Extract Tailwind CSS from PHP and HTML files like a breeze.**

Windrip is a lightweight Node.js tool that scans your PHP and HTML files (`.php`, `.html`, `.twig`) and extracts Tailwind CSS into optimized `.css` files using the Tailwind JIT CDN. Perfect for lean websites, multi-page PHP applications, or any project that wants Tailwind’s benefits without build tools like Vite, Webpack, or PostCSS. It’s especially designed for PHP developers (e.g., WordPress, Laravel) who need minimal, production-ready CSS.

The source code is located in the `src` folder (`src/index.js`).

---

## 🚀 Installation

```bash
npm install windrip
```

On first run, Windrip checks for dependencies (`http-server`, `puppeteer`, `chokidar`, `glob`, `minimist`, `prompts`, `clean-css`) and installs them automatically unless `--no-auto-install` is specified.

> **Note**: To process `.php` files or use the default PHP server (`php -S localhost:7890`), you must have [PHP](https://www.php.net/downloads.php) installed and available in your system PATH.

---

## 🌀 Quick Usage

### CLI

Extract Tailwind from the `src` folder:

```bash
npx windrip src
```

For PHP files with a custom server:

```bash
npx windrip src --output windrip --separate --watch --minify --server-command "php -S localhost:7890" --verbose
```

For PHP files using the default PHP server:

```bash
npx windrip src --file-extensions php
```

View help:

```bash
npx windrip --help
```

### Programmatic API

```javascript
const { extractTailwind, watch } = require('windrip');

// One-time extraction
extractTailwind({
  input: 'src',
  outputDir: 'windrip',
  separateBuilds: true,
  fileExtensions: ['html', 'php'],
  serverCommand: 'php -S localhost:7890',
  minify: true,
}).catch(console.error);

// Watch mode
watch({
  input: 'src',
  outputDir: 'windrip',
  separateBuilds: true,
  watch: true,
  fileExtensions: ['php'],
  verbose: true,
});
```

#### Example Script for API Usage

```javascript
const { extractTailwind, watch } = require('windrip');

async function runWindrip({
  mode = 'extract',
  input = 'src',
  outputDir = 'windrip',
  minify = true,
  fileExtensions = ['php', 'html'],
  serverCommand = 'php -S localhost:7890',
} = {}) {
  try {
    const options = { input, outputDir, minify, fileExtensions, serverCommand };
    if (mode === 'extract') {
      await extractTailwind(options);
      console.log('Tailwind extraction complete.');
    } else if (mode === 'watch') {
      watch(options);
    } else {
      throw new Error(`Unknown mode: ${mode}`);
    }
  } catch (err) {
    console.error(`${mode === 'extract' ? 'Extraction' : 'Watch'} error:`, err);
    process.exit(1);
  }
}

if (require.main === module) {
  const [mode = 'extract'] = process.argv.slice(2);
  runWindrip({ mode });
}

module.exports = runWindrip;

// Usage: node script.js [extract|watch]
```

---

## ⚙️ Tailwind Configuration

Customize Tailwind with a `tailwind.config.js`:

```javascript
module.exports = {
  content: ['./src/**/*.{html,php,twig}'],
  theme: {
    extend: {
      colors: {
        custom: '#123456',
      },
    },
  },
  plugins: [],
};
```

If no config is provided, Windrip uses:

```javascript
{ theme: { extend: {} }, plugins: [] }
```

---

## 📦 Options

| Option             | Type       | Default                              | Description                                      |
|--------------------|------------|--------------------------------------|--------------------------------------------------|
| `input`            | `string`   | `src`                                | Input directory with frontend files              |
| `outputDir`        | `string`   | `windrip`                            | Output directory for build files                 |
| `cssOutput`        | `string`   | `build.css`                          | Shared CSS output filename (non-separate builds) |
| `jsOutput`         | `string`   | `build.js`                           | Shared JS output filename (non-separate builds)  |
| `hashFile`         | `string`   | `.csshash`                           | File to track extracted classes                  |
| `port`             | `number`   | `7890`                               | Development server port                          |
| `tailwindCdn`      | `string`   | `https://cdn.tailwindcss.com`        | Tailwind CDN URL                                 |
| `configFile`       | `string`   | `tailwind.config.js`                 | Path to Tailwind config file                     |
| `watch`            | `boolean`  | `false`                              | Enable watch mode for auto-rebuilds              |
| `recursive`        | `boolean`  | `true`                               | Scan subdirectories                              |
| `separateBuilds`   | `boolean`  | `true`                               | Generate separate `.css`/`.js` per file          |
| `autoInstall`      | `boolean`  | `true`                               | Auto-install missing dependencies                |
| `fileExtensions`   | `string[]` | `['html', 'php', 'twig']`            | File types to process                            |
| `serverCommand`    | `string`   | `null` (defaults to `php -S localhost:7890` for PHP) | Command for dynamic server (e.g., PHP) |
| `minify`           | `boolean`  | `false`                              | Minify CSS output                                |
| `verbose`          | `boolean`  | `false`                              | Enable detailed logging                          |
| `dryRun`           | `boolean`  | `false`                              | Log actions without modifying files              |
| `backupOriginals`  | `boolean`  | `true`                               | Backup source files before modification          |
| `timeout`          | `number`   | `30000`                              | Browser timeout (ms)                             |
| `retries`          | `number`   | `3`                                  | Retry attempts for failed page loads             |
| `includeExternal`  | `boolean`  | `false`                              | Include external CSS in build output             |
| `unlinkExternal`   | `boolean`  | `false`                              | Remove external CSS links from files             |

---

## ⚖️ CLI Flags

| Flag                  | Description                                          |
|-----------------------|------------------------------------------------------|
| `--input <path>`      | Input directory                                      |
| `--output <path>`     | Output directory                                     |
| `--watch`             | Enable watch mode                                    |
| `--separate`          | Generate separate `.css`/`.js` per file              |
| `--no-auto-install`   | Skip dependency install prompts                      |
| `--no-backup`         | Disable source file backups                          |
| `--server-command <cmd>` | Custom server command (e.g., `php -S localhost:7890`) |
| `--file-extensions <list>` | Comma-separated extensions (e.g., `html,php`)       |
| `--minify`            | Minify CSS output                                    |
| `--timeout <ms>`      | Browser timeout (ms)                                 |
| `--retries <n>`       | Retry attempts for failed pages                      |
| `--verbose`           | Enable verbose logging                               |
| `--dry-run`           | Log actions without modifying files                  |
| `--include-external`  | Include external CSS in build output                 |
| `--unlink-external`   | Unlink external CSS files and include in build       |
| `--help`, `-h`        | Show help information                                |

---

## 🎯 Features

- **PHP and HTML Focus**: Optimized for `.php`, `.html`, and `.twig` files, extracting Tailwind CSS and inline JavaScript without build tools.
- **PHP Support**: Automatically runs a PHP server (`php -S localhost:7890`) for `.php` files unless overridden.
- **Simple Class Extraction**: Captures classes from `class` attributes and basic PHP conditionals (e.g., `<div class="<?php echo $isBold ? 'font-bold' : ''; ?>">`).
- **Separate Builds**: Generates per-file `.css` and `.js` outputs (e.g., `index.php.css`, `index.html.css`) with `--separate` (default: `true`).
- **Watch Mode**: Rebuilds on file changes with `--watch`.
- **Minification**: Optional CSS minification with `--minify`.
- **Smart CDN Usage**: Leverages Tailwind’s JIT CDN for fast, minimal builds.
- **Backup & Safety**: Backs up source files before modification (disable with `--no-backup`).

---

## 🛠️ Usage Notes

- **PHP and Twig Files**: Windrip defaults to `php -S localhost:7890` for `.php` or `.twig` files if no `--server-command` is provided. Override with a custom command if needed.
- **Class Extraction**: Supports static classes (e.g., `<div class="text-center font-bold">`) and simple PHP conditionals. Complex JavaScript frameworks (e.g., React, Vue) are not fully supported as they typically require build tools.
- **Separate Builds**: Each file gets its own `filename.css` and `filename.js` (e.g., `index.php.css` for `index.php`).
- **CI/CD**: Use `--no-auto-install` and pre-install dependencies for consistent builds.

---

## 🌟 Why Windrip?

Windrip is tailored for PHP and HTML developers who want Tailwind’s utility-first CSS without the complexity of build tools. It:

- Extracts only used classes for tiny, production-ready builds.
- Removes runtime CDN overhead.
- Supports PHP servers for dynamic rendering.
- Simplifies workflows for WordPress, Laravel, or static HTML sites.

Build lean, ship fast, stay breezy with Windrip.

---

## ❓ FAQ

**Q: Why are no classes extracted from my PHP files?**
A: Ensure PHP files are served correctly (e.g., via `php -S localhost:7890`). Use `--verbose` to debug.

**Q: How do I use a custom PHP server?**
A: Specify `--server-command "your-command"`, e.g., `npx windrip src --server-command "php -S localhost:8000"`.

**Q: Can I disable backups?**
A: Yes, use `--no-backup` to skip backing up source files.

---

## 🤝 Contributing

Want to contribute? Check out our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Open issues or pull requests on [GitHub](https://github.com/nigeriandream/windrip).

---

## 📄 License

GPL-3.0 © [Ozor A.]

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See the [LICENSE](LICENSE) file for details.

---

[![npm version](https://img.shields.io/npm/v/windrip)](https://www.npmjs.com/package/windrip)
[![license](https://img.shields.io/npm/l/windrip)](https://github.com/nigeriandream/windrip/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/windrip)](https://www.npmjs.com/package/windrip)

```

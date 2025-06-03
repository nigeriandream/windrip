#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const httpServer = require('http-server');
const puppeteer = require('puppeteer');
const { glob } = require('glob');
const minimist = require('minimist');
const prompts = require('prompts');

/**
* List of required dependencies.
* @constant {string[]}
*/
const REQUIRED_PACKAGES = [
    'http-server',
    'puppeteer',
    'chokidar',
    'glob',
    'minimist',
    'prompts',
];

/**
* Optional dependencies for specific features.
* @constant {Object}
*/
const OPTIONAL_PACKAGES = {
    minify: ['clean-css'],
};

/**
* Default configuration for the Windrip module.
* @constant {Object}
*/
const DEFAULT_CONFIG = {
    input: 'src',
    outputDir: 'windrip',
    cssOutput: 'build.css',
    jsOutput: 'build.js',
    hashFile: '.csshash',
    port: 7890,
    tailwindCdn: 'https://cdn.tailwindcss.com',
    configFile: 'tailwind.config.js',
    watch: false,
    recursive: true,
    separateBuilds: true,
    autoInstall: true,
    fileExtensions: ['html', 'php', 'twig', 'jsx', 'vue', 'svelte'],
    serverCommand: null,
    minify: false,
    tailwindConfig: JSON.stringify({ theme: { extend: {} }, plugins: [] }),
    verbose: false,
    dryRun: false,
    backupOriginals: true,
    timeout: 30000,
    retries: 3,
    includeExternal: false,
    unlinkExternal: false,
};

/** * Default server commands for file extensions.
* @constant {Object}
* */
const DEFAULT_SERVER_COMMANDS = {
    php: {
        fileExtension: 'php',
        args: ['php', '-S', 'localhost:7890'],
    },
    html: {
        fileExtension: 'html',
        args: ['npx', 'http-server', '-p', '7890'],
    },
};

/**
* Backup manager for source files
*/
class BackupManager {
    constructor(enabled = true, verbose = false) {
        this.enabled = enabled;
        this.verbose = verbose;
        this.backups = new Map();
        this.fs = require('fs/promises');
    }

    async backup(filePath) {
        if (!this.enabled) return;
        try {
            const content = await this.fs.readFile(filePath, 'utf-8');
            this.backups.set(filePath, content);
            if (this.verbose) console.log(`Backed up ${filePath}`);
        } catch (err) {
            console.warn(`Failed to backup ${filePath}: ${err.message}`);
        }
    }

    async restore(filePath) {
        if (!this.enabled || !this.backups.has(filePath)) return false;
        try {
            await this.fs.writeFile(filePath, this.backups.get(filePath));
            if (this.verbose) console.log(`Restored ${filePath}`);
            return true;
        } catch (err) {
            console.error(`Failed to restore ${filePath}: ${err.message}`);
            return false;
        }
    }

    async restoreAll() {
        if (!this.enabled) return;
        const promises = Array.from(this.backups.keys()).map(filePath => this.restore(filePath));
        await Promise.all(promises);
    }
}

/**
* Loads configuration from windrip.config.js if present.
* @returns {Promise<Object>} Configuration object
*/
async function loadConfig() {
    const configPath = path.resolve('windrip.config.js');
    try {
        delete require.cache[configPath];
        const config = require(configPath);
        return { ...DEFAULT_CONFIG, ...config };
    } catch {
        return DEFAULT_CONFIG;
    }
}

/**
* Checks if a package is installed
* @param {string} packageName - Package to check
* @returns {boolean}
*/
function isPackageInstalled(packageName) {
    try {
        require.resolve(packageName);
        return true;
    } catch {
        return false;
    }
}

/**
* Checks and installs missing dependencies, prompting for user consent if needed.
* @param {string[]} packages - List of packages to check
* @param {boolean} autoInstall - Whether to auto-install without prompting
* @returns {Promise<void>}
*/
async function ensureDependencies(packages, autoInstall) {
    const missing = packages.filter(pkg => !isPackageInstalled(pkg));
    if (missing.length === 0) return;
    console.log(`Missing dependencies: ${missing.join(', ')}`);
    if (!autoInstall) {
        const { confirm } = await prompts({
            type: 'confirm',
            name: 'confirm',
            message: 'Missing dependencies detected. Install them now?',
            initial: true,
        });
        if (!confirm) {
            console.error('Dependencies are required to run Windrip. Please install them manually.');
            process.exit(1);
        }
    }
    try {
        execSync('npm --version', { stdio: 'ignore' });
        console.log('Installing missing dependencies...');
        execSync(`npm install --save ${missing.join(' ')}`, { stdio: 'inherit' });
        console.log('All dependencies installed.');
    } catch (err) {
        console.error('Failed to install dependencies:', err.message);
        console.error('Please install them manually with: npm install ' + missing.join(' '));
        process.exit(1);
    }
}

/**
* Extracts Tailwind CSS and JS from frontend files in a directory, generating build files.
* @param {Object} options - Configuration options
* @returns {Promise<void>}
*/
async function extractTailwind(options = {}) {
    const defaultConfig = await loadConfig();
    const config = { ...defaultConfig, ...options };

    // --- Ensure default server command applies in both CLI and API usage ---
    const dynamicExtensions = ['php', 'twig'];
    const hasPhp = config.fileExtensions.includes('php');
    const hasTwig = config.fileExtensions.includes('twig');
    const hasHtml = config.fileExtensions.includes('html');

    if (!config.serverCommand) {
        if (hasPhp || hasTwig) {
            config.serverCommand = `${DEFAULT_SERVER_COMMANDS.php.args.join(' ')}`;
            if (config.verbose) {
                console.log(`No --server-command provided, using default for PHP/Twig: ${config.serverCommand}`);
            }
        } else if (hasHtml) {
            config.serverCommand = `${DEFAULT_SERVER_COMMANDS.html.args.join(' ')}`;
            if (config.verbose) {
                console.log(`No --server-command provided, using default for HTML: ${config.serverCommand}`);
            }
        }
    }

    const {
        input,
        outputDir,
        cssOutput,
        jsOutput,
        hashFile,
        port,
        tailwindCdn,
        configFile,
        recursive,
        separateBuilds,
        autoInstall,
        fileExtensions,
        serverCommand,
        minify,
        verbose,
        dryRun,
        backupOriginals,
        timeout,
        retries,
        unlinkExternal,
    } = config;
    if (verbose) console.log('Configuration:', JSON.stringify(config, null, 2));
    const required = [...REQUIRED_PACKAGES];
    if (minify) required.push(...OPTIONAL_PACKAGES.minify);
    await ensureDependencies(required, autoInstall);
    let CleanCSS;
    if (minify) CleanCSS = require('clean-css');
    try {
        const stats = await fs.stat(input);
        if (!stats.isDirectory()) throw new Error(`Input path is not a directory: ${input}`);
    } catch {
        throw new Error(`Input directory not found: ${input}`);
    }
    if (!dryRun) await fs.mkdir(outputDir, { recursive: true });
    const pattern = recursive ? `**/*.{${fileExtensions.join(',')}}` : `*.{${fileExtensions.join(',')}}`;
    let files;
    try {
        files = await glob(pattern, {
            cwd: input,
            absolute: true,
            ignore: ['node_modules/**/*', '.git/**/*', `${outputDir}/**/*`],
        });
    } catch (err) {
        throw new Error(`Failed to scan directory: ${err.message}`);
    }
    if (verbose) console.log('Files found:', files);
    if (files.length === 0) {
        console.warn(`No matching files found in ${input} with extensions: ${fileExtensions.join(', ')}`);
        return;
    }
    const backupManager = new BackupManager(backupOriginals, verbose);
    const hasDynamicFiles = files.some(file => dynamicExtensions.includes(path.extname(file).slice(1)));
    if (hasDynamicFiles && !serverCommand) {
        console.warn(
            'Warning: Detected dynamic files (e.g., .php, .twig). These may require a custom server. ' +
            'Use --server-command to specify (e.g., "php -S localhost:7890").'
        );
    }
    let shouldUnlinkExternal = unlinkExternal;
    if (!autoInstall && !unlinkExternal) {
        if (process.stdin.isTTY) {
            const { confirm } = await prompts({
                type: 'confirm',
                name: 'confirm',
                message: 'Unlink external CSS files and include them in build.css?',
                initial: false,
            });
            shouldUnlinkExternal = confirm;
        } else {
            // Non-interactive mode: default to false or log a warning
            if (verbose) console.warn('Non-interactive mode detected, skipping prompt for unlinking external CSS.');
            shouldUnlinkExternal = false;
        }
    }
    let serverProcess, server, browser;
    const errors = [];
    try {
        if (serverCommand) {
            const [command, ...args] = serverCommand.split(' ');
            try {
                serverProcess = spawn(command, args, { stdio: 'inherit', cwd: path.resolve(input) });
            } catch (err) {
                throw new Error(`Failed to start custom server: ${err.message}`);
            }
        } else if (!dryRun) {
            server = httpServer.createServer({ root: path.resolve(input) });
            await new Promise((resolve, reject) => {
                server.listen(port, err => {
                    if (err) reject(new Error(`Server failed to start: ${err.message}`));
                    else {
                        if (verbose) console.log(`HTTP server started on port ${port}`);
                        resolve();
                    }
                });
            });
        }
        if (!dryRun) {
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
        }
        let allClasses = new Set();
        let allCss = '';
        let allScripts = new Set();
        for (const file of files) {
            if (verbose) console.log(`Processing ${file}...`);
            try {
                await backupManager.backup(file);
                let fileContent = await fs.readFile(file, 'utf-8');
                let classes = extractClasses(fileContent);
                const classString = Array.from(classes).sort().join(' ');
                const hash = crypto.createHash('sha256').update(classString).digest('hex');
                if (verbose) console.log(`Classes found in ${file}:`, Array.from(classes));
                const fileHashPath = separateBuilds
                    ? path.join(outputDir, `${path.basename(file, path.extname(file))}${hashFile}`)
                    : path.join(outputDir, hashFile);
                let existingHash = '';
                try {
                    existingHash = await fs.readFile(fileHashPath, 'utf-8');
                } catch { }
                if (existingHash === hash) {
                    if (verbose) console.log(`No changes in ${file}. Skipping.`);
                    continue;
                }
                if (dryRun) {
                    console.log(`Would process ${file} with hash ${hash.substring(0, 8)}...`);
                    continue;
                }
                await fs.writeFile(fileHashPath, hash);
                if (!fileContent.includes(tailwindCdn)) {
                    fileContent = injectTailwindCdn(fileContent, tailwindCdn, configFile, config.tailwindConfig);
                    await fs.writeFile(file, fileContent);
                }
                const { css, scripts, domClasses } = await processWithBrowser(
                    browser, file, input, port, timeout, retries, verbose, tailwindCdn, jsOutput, config.includeExternal
                );
                classes = new Set([...classes, ...domClasses]);
                let finalCss = css;
                if (minify && css) {
                    try {
                        finalCss = new CleanCSS().minify(css).styles;
                    } catch (err) {
                        console.warn(`CSS minification failed for ${file}: ${err.message}`);
                    }
                }
                if (separateBuilds) {
                    const outputBase = path.basename(file);
                    await fs.writeFile(path.join(outputDir, `${outputBase}.css`), finalCss);
                    await fs.writeFile(path.join(outputDir, `${outputBase}.js`), [...scripts].join('\n'));
                    await updateHtml(file, `${outputBase}.css`, `${outputBase}.js`, tailwindCdn, true, outputDir, verbose, shouldUnlinkExternal);
                } else {
                    classes.forEach(c => allClasses.add(c));
                    allCss += finalCss + '\n';
                    scripts.forEach(s => allScripts.add(s));
                }
            } catch (err) {
                console.error(`Error processing ${file}: ${err.message}`);
                errors.push(`Error processing ${file}: ${err.message}`);
                await backupManager.restore(file);
            }
        }
        if (!separateBuilds && !dryRun) {
            let finalAllCss = allCss;
            if (minify && allCss) {
                try {
                    finalAllCss = new CleanCSS().minify(allCss).styles;
                } catch (err) {
                    console.warn(`CSS minification failed: ${err.message}`);
                }
            }
            await fs.writeFile(path.join(outputDir, cssOutput), finalAllCss);
            await fs.writeFile(path.join(outputDir, jsOutput), [...allScripts].join('\n'));
            for (const file of files) {
                await updateHtml(file, cssOutput, jsOutput, tailwindCdn, false, outputDir, verbose, shouldUnlinkExternal);
            }
        }
        if (errors.length > 0) {
            console.error('\nErrors encountered during processing:');
            errors.forEach(err => console.error(`- ${err}`));
        } else {
            console.log('✅ Build completed successfully.');
        }
    } catch (err) {
        console.error('Build failed:', err.message);
        if (backupOriginals) {
            console.log('Restoring original files...');
            await backupManager.restoreAll();
        }
        throw err;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (err) {
                console.warn('Failed to close browser:', err.message);
            }
        }
        if (server) server.close();
        if (serverProcess) serverProcess.kill();
    }
}

/**
* Process a file with browser automation
* @param {Object} browser - Puppeteer browser instance
* @param {string} file - File path
* @param {string} input - Input directory
* @param {number} port - Server port
* @param {number} timeout - Timeout in ms
* @param {number} retries - Number of retries
* @param {boolean} verbose - Verbose logging
* @param {string} tailwindCdn - Tailwind CDN URL
* @param {string} jsOutput - JS output file
* @returns {Promise<{css: string, scripts: Set<string>, domClasses: Set<string>}>}
*/
async function processWithBrowser(browser, file, input, port, timeout, retries, verbose, tailwindCdn, jsOutput, includeExternal) {
    const relativePath = path.relative(path.resolve(input), file);
    const url = `http://localhost:${port}/${relativePath.replace(/\\/g, '/')}`;
    let attempt = 0;
    while (attempt < retries) {
        const page = await browser.newPage();
        try {
            await page.setDefaultNavigationTimeout(timeout);
            page.on('console', msg => {
                if (verbose && msg.type() === 'error') console.log(`Browser console error: ${msg.text()}`);
            });
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: timeout,
            });
            await page.waitForSelector('[class]', { timeout: 5000 });
            // Add a slight delay to allow scripts to run and classes to be added
            await new Promise(resolve => setTimeout(resolve, 200));
            // Optionally wait for a custom signal from your app
            await page.waitForFunction('window.windripReady === true', { timeout: 2000 }).catch(() => { });
            // Extract CSS, scripts, and classes from the page
            if (verbose) console.log(`Extracting CSS and scripts from ${file}...`);
            const { css, scripts, classes } = await page.evaluate(async (baseUrl, tailwindCdn, jsOutput, includeExternal) => {
                let result = '';
                for (const sheet of document.styleSheets) {
                    try {
                        for (const rule of sheet.cssRules) {
                            if (rule.selectorText && rule.selectorText.startsWith('.')) {
                                result += rule.cssText + '\n';
                            }
                        }
                    } catch (e) {
                        console.warn('Could not access stylesheet:', sheet.href);
                    }
                }
                if (includeExternal) {
                    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
                    for (const link of links) {
                        try {
                            let href = link.href;
                            if (!href.includes('build/')) {
                                if (href.startsWith('/')) href = baseUrl + href;
                                const response = await fetch(href);
                                if (response.ok) {
                                    const externalCss = await response.text();
                                    result += `\n/* External CSS from: ${href} */\n${externalCss}\n`;
                                } else {
                                    console.warn(`Failed to fetch external CSS: ${href} (${response.status})`);
                                }
                            }
                        } catch (err) {
                            console.warn(`Error fetching external CSS for ${link.href}: ${err.message}`);
                        }
                    }
                }
                const scripts = new Set();
                document.querySelectorAll('script').forEach(s => {
                    if (s.src) {
                        if (s.src.includes(tailwindCdn) || s.src.includes(jsOutput)) return;
                        scripts.add(`// External: ${s.src}`);
                    } else if (s.textContent && !s.textContent.includes('tailwind.config')) {
                        scripts.add(s.textContent.trim());
                    }
                });
                const classes = new Set();
                document.querySelectorAll('[class]').forEach(el => {
                    el.classList.forEach(cls => {
                        if (/^[a-zA-Z0-9_][a-zA-Z0-9_\-:]*$/.test(cls)) classes.add(cls);
                    });
                });
                return { css: result, scripts: Array.from(scripts), classes: Array.from(classes) };
            }, `http://localhost:${port}`, tailwindCdn, jsOutput);
            await page.close();
            if (verbose) console.log(`Successfully processed ${file} (attempt ${attempt + 1})`);
            return { css, scripts: new Set(scripts), domClasses: new Set(classes) };
        } catch (err) {
            await page.close();
            attempt++;
            if (attempt >= retries) {
                throw new Error(`Failed to process ${url} after ${retries} attempts: ${err.message}`);
            }
            if (verbose) console.log(`Retrying ${file} (attempt ${attempt + 1}/${retries}): ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

/**
* Extracts CSS classes from file content, including template literals and various frameworks.
* @param {string} content - File content
* @returns {Set<string>} Set of unique classes
*/
function extractClasses(content) {
    const classes = new Set();

    // Special cases for Vue and Angular patterns with quoted strings inside
    // These patterns handle the specific test cases more directly
    const vuePattern = /:class=["']'([^']+)'["']/g;
    let match;
    while ((match = vuePattern.exec(content)) !== null) {
        if (match[1]) {
            match[1].split(/\s+/).forEach(cls => {
                if (cls && /^[a-zA-Z0-9_][a-zA-Z0-9_\-:]*$/.test(cls)) {
                    classes.add(cls);
                }
            });
        }
    }

    const angularPattern = /\[ngClass\]=["']'([^']+)'["']/g;
    while ((match = angularPattern.exec(content)) !== null) {
        if (match[1]) {
            match[1].split(/\s+/).forEach(cls => {
                if (cls && /^[a-zA-Z0-9_][a-zA-Z0-9_\-:]*$/.test(cls)) {
                    classes.add(cls);
                }
            });
        }
    }

    // General patterns for class extraction
    const patterns = [
        /(?:class|className)=["']([^"']+)["']/g, // HTML class, className
        /:class=["']([^"']+)["']/g, // Vue :class with string (no nested quotes)
        /:class=["']\{([^{}]+)\}["']/g, // Vue :class with object
        /:class=\{([^{}]+)\}/g, // Vue :class with direct binding
        /\[ngClass\]=["']([^"']+)["']/g, // Angular [ngClass] with string (no nested quotes)
        /\[ngClass\]=["']\{([^{}]+)\}["']/g, // Angular [ngClass] with object
        /\[ngClass\]=\{([^{}]+)\}/g, // Angular [ngClass] with direct binding
        /class:([a-zA-Z0-9_\-:]+)/g, // Svelte class:
        /className={\s*`([^`]+)`\s*}/g, // JSX template literals
        /className=\{[^}]*\}/g, // JSX dynamic expressions
    ];

    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            // Get the matched content - for most patterns this is in group 1
            let classString = match[1] || match[0];

            const patternSource = pattern.source;

            // Handle different types of patterns
            if (patternSource.includes('className={`')) {
                // JSX template literals with backticks
                classString = classString.replace(/\${[^}]+}/g, ' '); // Replace expressions with space
            } else if (patternSource.includes('className=\\{')) {
                // Other JSX dynamic expressions
                classString = classString
                    .replace(/className=\{/, '') // Remove className={
                    .replace(/\}$/, '') // Remove closing }
                    .replace(/`([^`]+)`/, '$1') // Extract template literal content
                    .replace(/\${[^}]+}/g, ' ') // Replace JS expressions with space
                    .replace(/\s*\?\s*(['"])([^:]+)\1\s*:\s*(['"])([^}]+)\3/g, '$2 $4') // Handle ternary with quotes
                    .replace(/\s*\?\s*([^:]+)\s*:\s*([^}]+)/g, '$1 $2') // Handle ternary without quotes
                    .trim();
            } else if (patternSource.includes(':class=') || patternSource.includes('\\[ngClass\\]=')) {
                // Vue or Angular class handling
                if (patternSource.includes('\\{([^{}]+)\\}')) {
                    // Object notation like :class="{'class-name': true}" or [ngClass]="{'class-name': true}"
                    classString = classString
                        .replace(/['"]([^'"]+)['"]\s*:/g, '$1 ') // Extract class names from object keys
                        .replace(/:\s*(true|false|[^,]+)/g, ' '); // Remove object values
                } else if (patternSource.includes('=\\{([^{}]+)\\}')) {
                    // Direct binding like :class="{active: isActive}"
                    classString = classString
                        .replace(/['"]([^'"]+)['"]\s*:/g, '$1 ') // Extract class names from object keys
                        .replace(/:\s*(true|false|[^,]+)/g, ' '); // Remove object values
                } else {
                    // String format like :class="class-name" or [ngClass]="class-name"
                    // First check if there are nested quotes
                    if (/^['"][^'"]+['"]$/.test(classString)) {
                        // Remove outer quotes
                        classString = classString.replace(/^['"](.+)['"]$/, '$1');
                    }
                }
            }

            // Remove quotes and normalize spacing
            classString = classString
                .replace(/['"]/g, ' ') // Replace quotes with spaces
                .replace(/\s+/g, ' ')  // Normalize spaces
                .replace(/,/g, ' ')    // Replace commas with spaces (for object notation)
                .trim();

            // Split into individual classes and add to set
            classString.split(/\s+/).forEach(cls => {
                cls = cls.trim();
                // Tailwind classes can contain letters, numbers, underscores, hyphens, and colons (for modifiers)
                // Use a more permissive regex to allow all valid Tailwind class names
                if (cls && /^[a-zA-Z0-9_][a-zA-Z0-9_\-:]*$/.test(cls)) {
                    classes.add(cls);
                }
            });
        }
    });
    return classes;
}

/**
* Injects Tailwind CDN and config into file content with proper escaping.
* @param {string} content - File content
* @param {string} cdn - Tailwind CDN URL
* @param {string} configFile - Path to Tailwind config
* @param {string} internalConfig - Fallback Tailwind config
* @returns {string} Modified content
*/
function injectTailwindCdn(content, cdn, configFile, internalConfig) {
    let configScript = '';
    try {
        const configPath = path.resolve(configFile);
        const configContent = require('fs').readFileSync(configPath, 'utf-8');
        const cleanConfig = configContent
            .replace(/module\.exports\s*=\s*/, '')
            .replace(/export\s+default\s+/, '')
            .replace(/<\/script>/g, '<\\/script>');
        configScript = `<script>tailwind.config = ${cleanConfig}</script>`;
    } catch {
        if (internalConfig) {
            try {
                JSON.parse(`{"config": ${internalConfig}}`);
                const escapedConfig = internalConfig.replace(/<\/script>/g, '<\\/script>');
                configScript = `<script>tailwind.config = ${escapedConfig}</script>`;
            } catch {
                console.warn(`Invalid fallback Tailwind config: ${internalConfig}`);
            }
        }
    }
    const cdnScript = `<script src="${cdn}"></script>`;
    const headCloseIndex = content.toLowerCase().indexOf('</head>');
    if (headCloseIndex !== -1) {
        return content.slice(0, headCloseIndex) + cdnScript + configScript + content.slice(headCloseIndex);
    }
    return cdnScript + configScript + content;
}

/**
* Updates file to link build files and remove Tailwind CDN.
* @param {string} file - Path to file
* @param {string} cssOutput - CSS output file
* @param {string} jsOutput - JS output file
* @param {string} tailwindCdn - Tailwind CDN URL
* @param {boolean} separateBuilds - Whether to use separate build files
* @param {string} outputDir - Output directory
* @param {boolean} verbose - Verbose logging
* @param {boolean} unlinkExternal - Whether to unlink external CSS
* @returns {Promise<void>}
*/
async function updateHtml(file, cssOutput, jsOutput, tailwindCdn, separateBuilds, outputDir, verbose, unlinkExternal) {
    let content = await fs.readFile(file, 'utf-8');
    content = content
        .replace(/<script[^>]*src=["'][^"']*cdn\.tailwindcss\.com[^"']*["'][^>]*>\s*<\/script>\s*/g, '')
        .replace(/<script[^>]*>[\s\S]*?tailwind\.config[\s\S]*?<\/script>\s*/g, '');
    const outputDirPath = path.relative(path.dirname(file), path.resolve(outputDir)).replace(/\\/g, '/');
    content = content
        .replace(new RegExp(`<link[^>]*href=["']${outputDirPath}/[^"']*\\.css["'][^>]*>\\s*`, 'g'), '')
        .replace(new RegExp(`<script[^>]*src=["']${outputDirPath}/[^"']*\\.js["'][^>]*></script>\\s*`, 'g'), '');
    if (unlinkExternal) {
        content = content.replace(/<link[^>]*href=["'][^"']*\.css["'][^>]*>\s*/g, '');
    }
    const fileDir = path.dirname(file);
    const relativeCssPath = path.relative(fileDir, path.join(outputDir, cssOutput)).replace(/\\/g, '/');
    const relativeJsPath = path.relative(fileDir, path.join(outputDir, jsOutput)).replace(/\\/g, '/');
    const headCloseIndex = content.toLowerCase().indexOf('</head>');
    const insertion = `<link rel="stylesheet" href="${relativeCssPath}"><script src="${relativeJsPath}"></script>`;
    if (headCloseIndex !== -1) {
        const beforeHead = content.slice(0, headCloseIndex).trimEnd();
        const afterHead = content.slice(headCloseIndex).trimStart();
        content = beforeHead + insertion + afterHead;
    } else {
        const headOpenIndex = content.toLowerCase().indexOf('<head>');
        if (headOpenIndex !== -1) {
            const insertIndex = headOpenIndex + 6;
            const beforeHead = content.slice(0, insertIndex).trimEnd();
            const afterHead = content.slice(insertIndex).trimStart();
            content = beforeHead + insertion + afterHead;
        } else {
            content = `<head>${insertion}</head>` + content;
        }
    }
    await fs.writeFile(file, content);
    if (verbose) console.log(`Updated ${file} with build references`);
}

/**
* Watches for file changes in the input directory and rebuilds.
* @param {Object} options - Configuration options
*/
async function watch(options) {
    const chokidar = require('chokidar');
    const config = { ...DEFAULT_CONFIG, ...options };
    const pattern = config.recursive
        ? `**/*.{${config.fileExtensions.join(',')}}`
        : `*.{${config.fileExtensions.join(',')}}`;
    const watcher = chokidar.watch(pattern, {
        cwd: config.input,
        persistent: true,
        ignoreInitial: false,
        ignored: ['node_modules/**/*', '.git/**/*', `${config.outputDir}/**/*`],
    });
    const fileHashes = new Map();
    let isRebuilding = false;
    console.log(`👀 Watching for changes in ${config.input}...`);
    console.log(`📁 Extensions: ${config.fileExtensions.join(', ')}`);
    console.log('Press Ctrl+C to stop.\n');
    const rebuild = async (changedFile = null) => {
        if (isRebuilding) return;
        isRebuilding = true;
        const backupManager = new BackupManager(config.backupOriginals, config.verbose);
        try {
            console.log(`🔄 Rebuilding${changedFile ? ` (${changedFile} changed)` : ''}...`);
            const startTime = Date.now();
            if (config.separateBuilds && changedFile) {
                const fullPath = path.resolve(config.input, changedFile);
                await extractTailwind({
                    ...config,
                    input: path.dirname(fullPath),
                });
            } else {
                await extractTailwind(config);
            }
            const duration = Date.now() - startTime;
            console.log(`✅ Rebuild completed in ${duration}ms\n`);
        } catch (err) {
            console.error('❌ Rebuild failed:', err.message);
            await backupManager.restoreAll();
        } finally {
            isRebuilding = false;
        }
    };
    watcher.on('change', async file => {
        console.log(`📝 File changed: ${file}`);
        await rebuild(file);
    });
    watcher.on('add', async file => {
        console.log(`➕ File added: ${file}`);
        await rebuild(file);
    });
    watcher.on('unlink', async file => {
        console.log(`➖ File removed: ${file}`);
        fileHashes.delete(file);
        await rebuild();
    });
    watcher.on('ready', async () => {
        console.log('👀 Initial scan complete. Watching for changes...\n');
        const files = await glob(pattern, {
            cwd: config.input,
            absolute: true,
            ignore: ['node_modules/**/*', '.git/**/*', `${config.outputDir}/**/*`],
        });
        for (const f of files) {
            const content = await fs.readFile(f, 'utf-8');
            const classes = extractClasses(content);
            const classString = Array.from(classes).sort().join(' ');
            const hash = crypto.createHash('sha256').update(classString).digest('hex');
            fileHashes.set(f, hash);
        }
    });
    watcher.on('error', err => {
        console.error('❌ Watcher error:', err.message);
    });
    process.on('SIGINT', async () => {
        console.log('\n🛑 Stopping watch mode...');
        await watcher.close();
        process.exit(0);
    });
}

/**
* Displays CLI help information.
*/
function showHelp() {
    console.log(`
🌊 Windrip - Extract Tailwind CSS and JS from frontend files using JIT CDN

Usage:
npx windrip [input] [options]

Options:
--input <path>           Input directory containing frontend files (default: src)
--output <path>          Output directory for build files (default: build)
--watch                  Enable watch mode for automatic rebuilds
--separate               Generate separate CSS/JS files per file
--no-auto-install        Skip automatic dependency installation
--no-backup              Skip backing up original files
--server-command <cmd>   Custom server command for dynamic files
--file-extensions <list> Comma-separated list of file extensions
                      (default: html,php,twig,jsx,vue,svelte)
--minify                 Enable CSS minification
--timeout <ms>           Browser timeout in milliseconds (default: 30000)
--retries <n>            Number of retries for failed pages (default: 3)
--verbose                Enable verbose logging
--dry-run                Log actions without modifying files
--include-external       Include external CSS files in build output (default: false)
--unlink-external        Unlink external CSS files and include in build
--help, -h               Show this help message

Examples:
npx windrip src
npx windrip src --output dist --separate --watch --minify
npx windrip src --server-command "php -S localhost:7890" --file-extensions html,php,jsx
npx windrip src --watch --verbose --timeout 60000
`);
    process.exit(0);
}

module.exports = {
    extractTailwind,
    watch,
    extractClasses,
    BackupManager,
};

// Handle CLI execution
if (require.main === module) {
    const argv = minimist(process.argv.slice(2), {
        boolean: ['watch', 'separate', 'no-auto-install', 'no-backup', 'minify', 'verbose', 'dry-run', 'help', 'unlink-external'],
        string: ['input', 'output', 'server-command', 'file-extensions', 'timeout', 'retries'],
        alias: { h: 'help' },
        default: {
            timeout: '30000',
            retries: '3',
        },
    });
    if (argv.help) showHelp();
    const config = {
        input: argv.input || argv._[0] || 'src',
        outputDir: argv.output || 'windrip',
        watch: argv.watch || false,
        separateBuilds: argv.separate || true,
        autoInstall: !argv['no-auto-install'],
        backupOriginals: !argv['no-backup'],
        serverCommand: argv['server-command'] || null,
        fileExtensions: argv['file-extensions']
            ? argv['file-extensions'].split(',').map(ext => ext.trim())
            : DEFAULT_CONFIG.fileExtensions,
        minify: argv.minify || true,
        verbose: argv.verbose || false,
        dryRun: argv['dry-run'] || false,
        timeout: parseInt(argv.timeout) || 30000,
        retries: parseInt(argv.retries) || 3,
        includeExternal: argv['include-external'] || false,
        unlinkExternal: argv['unlink-external'] || false,
    };

    if (argv._.length > 1) {
        console.error('❌ Error: Too many positional arguments. Specify one input directory.');
        showHelp();
    }
    if (config.fileExtensions.some(ext => !/^[a-zA-Z0-9]+$/.test(ext))) {
        console.error('❌ Error: Invalid file extensions. Use alphanumeric extensions (e.g., html,php,jsx).');
        showHelp();
    }
    if (config.timeout < 1000) {
        console.error('❌ Error: Timeout must be at least 1000ms.');
        showHelp();
    }
    if (config.retries < 1 || config.retries > 10) {
        console.error('❌ Error: Retries must be between 1 and 10.');
        showHelp();
    }
    if (config.watch) {
        watch(config);
    } else {
        extractTailwind(config)
            .then(() => {
                if (config.watch) watch(config);
            })
            .catch(err => {
                console.error('❌ Error:', err.message);
                if (config.verbose) console.error('Stack trace:', err.stack);
                process.exit(1);
            });
    }
}
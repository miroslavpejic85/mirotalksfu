const fs = require('fs');

const chokidar = require('chokidar');

const packageJson = require('../../package.json');

const Logger = require('./Logger');
const { buildJsonLd, normalizeBaseUrl } = require('./Seo');

const log = new Logger('HtmlInjector');

class HtmlInjector {
    constructor(filesPath, config) {
        this.filesPath = filesPath; // Array of file paths to cache
        this.cache = {}; // Object to store cached files
        this.config = config; // Configuration containing metadata (OG, title, etc.)
        this.injectData = this.getInjectData(); // Initialize dynamic injection data
        this.watcher = null; // File watcher instance
        this.preloadPages(filesPath); // Preload pages at startup
        this.watchFiles(filesPath); // Watch files for changes
        log.info('filesPath cached', this.filesPath);
    }

    // Function to get dynamic data for injection (e.g., OG data, title, etc.)
    getInjectData() {
        const ogUrl = this.config?.og?.url || 'https://sfu.mirotalk.com';
        const ogTitle = this.config?.og?.title || 'MiroTalk SFU - Open Source WebRTC Video Conferencing';
        const ogDescription =
            this.config?.og?.description ||
            'Build your own Zoom alternative with MiroTalk SFU, an open-source self-hosted WebRTC video conferencing platform powered by Mediasoup. Host scalable meetings, webinars, classrooms, screen sharing and real-time collaboration.';
        const ogImage = this.config?.og?.image || 'https://sfu.mirotalk.com/images/mirotalksfu.png';
        return {
            APP_NAME: this.config?.app?.name || 'MiroTalk SFU',
            APP_VERSION: this.config?.html?.version === false ? '' : `v${packageJson.version}`,
            OG_TYPE: this.config?.og?.type || 'website',
            OG_SITE_NAME: this.config?.og?.siteName || 'MiroTalk SFU',
            OG_TITLE: ogTitle,
            OG_DESCRIPTION: ogDescription,
            OG_IMAGE: ogImage,
            OG_URL: ogUrl,
            CANONICAL_URL: `${normalizeBaseUrl(ogUrl)}/`,
            // Pre-serialized JSON-LD, injected raw (not HTML-escaped) inside a <script type="application/ld+json"> tag
            JSON_LD: buildJsonLd({
                name: this.config?.og?.siteName || 'MiroTalk SFU',
                description: ogDescription,
                url: ogUrl,
                image: ogImage,
            }),
            // Add more data here as needed with fallbacks
        };
    }

    // Replace visible placeholders that must never leak as raw {{...}} text
    replaceAppVersion(html) {
        return html.replace(/{{APP_VERSION}}/g, this.injectData.APP_VERSION);
    }

    // Replace the SEO placeholders that must resolve even when brand injection is disabled
    replaceSeoPlaceholders(html) {
        return html
            .replace(/{{CANONICAL_URL}}/g, () => this.escapeHtml(this.injectData.CANONICAL_URL))
            .replace(/{{JSON_LD}}/g, () => this.injectData.JSON_LD);
    }

    escapeHtml(value) {
        const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return String(value).replace(/[&<>"']/g, (character) => entities[character]);
    }

    replaceLandingSections(html) {
        if (!this.config?.htmlInjection) return html;

        const visibility = {
            ABOUT: this.config?.html?.landingAbout !== false,
            FAQ: this.config?.html?.faq !== false,
        };
        return html.replace(
            /<!-- LANDING_(ABOUT|FAQ)_START -->([\s\S]*?)<!-- LANDING_\1_END -->/g,
            (_, section, content) => (visibility[section] ? content : '')
        );
    }

    // Function to load a file into the cache
    loadFileToCache(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            this.cache[filePath] = this.replaceLandingSections(content); // Store the content in cache
        } catch (err) {
            log.error(`Error reading file: ${filePath}`, err);
        }
    }

    // Function to preload pages into the cache
    preloadPages(filePaths) {
        filePaths.forEach((filePath) => this.loadFileToCache(filePath));
    }

    // Function to watch files for changes using chokidar
    watchFiles(filePaths) {
        if (this.watcher) {
            this.watcher.close(); // Close existing watcher if any
        }

        this.watcher = chokidar.watch(filePaths, {
            persistent: true,
            ignoreInitial: true, // Ignore initial 'add' events
        });

        this.watcher
            .on('change', (filePath) => {
                log.debug(`File changed: ${filePath}`);
                this.loadFileToCache(filePath);
                log.debug(`Reloaded file ${filePath} into cache`);
            })
            .on('error', (error) => {
                log.error(`Watcher error: ${error.message}`);
            });
    }

    // Function to inject dynamic data (e.g., OG, TITLE, etc.) into a given file
    injectHtml(filePath, res) {
        const html = this.cache[filePath];

        if (!html) {
            log.error(`File not cached: ${filePath}`);
            if (!res.headersSent) {
                return res.status(500).send('Server Error');
            }
            return;
        }

        // Check if HTML injection is enabled in the config
        if (!this.config?.htmlInjection) {
            return res.send(
                this.replaceSeoPlaceholders(this.replaceAppVersion(html.replace(/{{APP_NAME}}/g, 'MiroTalk SFU')))
            );
        }

        try {
            // Replace placeholders with dynamic data (OG, TITLE, etc.)
            const modifiedHTML = this.replaceSeoPlaceholders(
                this.replaceAppVersion(
                    html.replace(/{{(APP_NAME|OG_[A-Z_]+)}}/g, (_, key) => this.escapeHtml(this.injectData[key] || ''))
                )
            );

            if (!res.headersSent) {
                res.send(modifiedHTML);
            }
        } catch (error) {
            log.error('Error injecting HTML data:', error);
            if (!res.headersSent) {
                res.status(500).send('Server Error');
            }
        }
    }

    // Cleanup watcher when the instance is no longer needed
    cleanup() {
        if (this.watcher) {
            this.watcher.close();
        }
    }
}

module.exports = HtmlInjector;

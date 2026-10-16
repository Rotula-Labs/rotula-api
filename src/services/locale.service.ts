import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';
import fs from 'fs';
import { observabilityService } from './observability.service';

const SUPPORTED_LANGUAGES = ['en', 'fr', 'yo', 'pcm', 'ha', 'ig'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

let initialised = false;

/**
 * Initializes the i18next instance and its backend for dynamic locale loading.
 * Configures chokidar for hot-reloading in development and validates that
 * all supported language JSON files have the same keys as the primary English ('en') locale.
 *
 * @returns {Promise<void>} A promise that resolves when i18next initialization is complete.
 */
export async function initI18n(): Promise<void> {
    const localesDir = path.join(__dirname, '../locales');

    await i18next
        .use(Backend)
        .init({
            lng: 'en',
            fallbackLng: 'en',
            backend: {
            },
            interpolation: {
                escapeValue: false
            },
        });

    // Strict mode is the default: a missing translation key or locale file
    // prevents startup unless explicitly opted out via I18N_STRICT=false.
    const strictMode = process.env.I18N_STRICT !== 'false';
    const missingFiles: string[] = [];
    const missingKeys: string[] = [];

    // Validate translations against en.json
    try {
        const enPath = path.join(localesDir, 'en.json');
        const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));
        const checkKeys = (obj: any, prefix = '') => {
            const keys: string[] = [];
            for (const k of Object.keys(obj)) {
                if (typeof obj[k] === 'object' && obj[k] !== null) {
                    keys.push(...checkKeys(obj[k], `${prefix}${k}.`));
                } else {
                    keys.push(`${prefix}${k}`);
                }
            }
            return keys;
        };
        const enKeys = checkKeys(enData);
        
        for (const lang of SUPPORTED_LANGUAGES) {
            if (lang === 'en') continue;
            try {
                const langPath = path.join(localesDir, `${lang}.json`);
                if (!fs.existsSync(langPath)) {
                    missingFiles.push(`${lang}.json`);
                    continue;
                }
                const langData = JSON.parse(fs.readFileSync(langPath, 'utf8'));
                const langKeys = new Set(checkKeys(langData));
                for (const key of enKeys) {
                    if (!langKeys.has(key)) {
                        missingKeys.push(`${lang}:${key}`);
                    }
                }
            } catch (err) {
                missingFiles.push(`${lang}.json`);
            }
        }
    } catch (err) {
        console.error('[i18n] Failed to validate locales on startup', err);
        missingFiles.push('en.json');
    }

    if (missingFiles.length > 0 || missingKeys.length > 0) {
        const details = [
            ...missingFiles.map(f => `missing translation file: ${f}`),
            ...missingKeys.map(k => `missing key ${k}`),
        ].join('; ');
        const message = `[i18n] Locale validation failed: ${details}`;
        if (strictMode) {
            throw new Error(message);
        }
        console.error(message);
        observabilityService.critical?.(message);
    }

    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        const chokidar = await import('chokidar');
        const watcher = chokidar.watch(localesDir, { ignoreInitial: true });
        watcher.on('change', (filePath: string) => {
            if (filePath.endsWith('.json')) {
                const lang = path.basename(filePath, '.json');
                if (SUPPORTED_LANGUAGES.includes(lang as any)) {
                    console.log(`[i18n] Reloading translations for ${lang}`);
                    i18next.reloadResources(lang).catch(err => {
                        console.error(`[i18n] Reload failed for ${lang}`, err);
                    });
                }
            }
        });
    }
    initialised = true;
}

/**
 * Determines whether a given language should be rendered Right-to-Left (RTL).
 *
 * @param {string} lang - The language code to check.
 * @returns {boolean} True if the language is RTL, false otherwise.
 */
export function isRTL(lang: string): boolean {
    return lang === 'ar';
}

/**
 * Translates a given key into the target language using i18next.
 * Automatically falls back to English ('en') if the target language is unsupported,
 * and handles Right-to-Left formatting marks for RTL languages.
 *
 * @param {string} key - The translation key path (e.g., 'send.success').
 * @param {string} lang - The target language code (e.g., 'en', 'fr').
 * @param {Record<string, any>} [params] - Optional interpolation variables for the translation string.
 * @returns {string} The localized string.
 */
export function t(
    key: string,
    lang: string,
    params?: Record<string, any>,
): string {
    const resolvedLang = SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage)
        ? lang
        : 'en';

    let message = i18next.t(key, { lng: resolvedLang, ...params });
    
    // Arabic/Hausa RTL support
    if (isRTL(resolvedLang)) {
        message = '\u200F' + message;
    }
    
    return message;
}

/**
 * Checks if a given language code is among the supported application languages.
 *
 * @param {string} lang - The language code to check.
 * @returns {boolean} True if the language is supported, false otherwise.
 */
export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
    return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}

/**
 * Ensures the given language is loaded into i18next asynchronously.
 * Useful for lazy-loading locales on demand instead of preloading all at startup.
 */
export async function loadLocale(lang: string): Promise<void> {
    if (isSupportedLanguage(lang)) {
        await i18next.loadLanguages(lang);
    }
}

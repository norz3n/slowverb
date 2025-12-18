/**
 * Browser Compatibility Layer
 * 
 * Provides unified API for Chrome and Firefox extensions.
 * Detects browser type and exports appropriate APIs.
 */

/**
 * Detect if running in Firefox.
 * Firefox has native `browser` object with getBrowserInfo.
 * @type {boolean}
 */
export const isFirefox = typeof browser !== 'undefined' && 
  typeof browser.runtime !== 'undefined' &&
  typeof browser.runtime.getBrowserInfo === 'function';

/**
 * Detect if running in Chrome/Chromium.
 * @type {boolean}
 */
export const isChrome = !isFirefox && typeof chrome !== 'undefined';

/**
 * Unified browser API.
 * Uses native `browser` in Firefox, `chrome` in Chromium.
 * Note: For full Promise support in Chrome, use webextension-polyfill.
 * @type {typeof browser | typeof chrome}
 */
export const browserAPI = isFirefox ? browser : chrome;

/**
 * Check if offscreen API is available (Chrome only).
 * @type {boolean}
 */
export const hasOffscreenAPI = isChrome && 
  typeof chrome.offscreen !== 'undefined';

/**
 * Check if tabCapture API is available.
 * Chrome: chrome.tabCapture.getMediaStreamId
 * Firefox: browser.tabs.captureTab (different API!)
 * @type {boolean}
 */
export const hasTabCaptureAPI = isChrome && 
  typeof chrome.tabCapture !== 'undefined';

/**
 * Check if Firefox captureTab is available.
 * @type {boolean}
 */
export const hasFirefoxCaptureTab = isFirefox &&
  typeof browser.tabs !== 'undefined' &&
  typeof browser.tabs.captureTab === 'function';

/**
 * Log browser detection results (for debugging).
 */
export function logBrowserInfo() {
  console.log('[Slowverb] Browser detection:', {
    isFirefox,
    isChrome,
    hasOffscreenAPI,
    hasTabCaptureAPI,
    hasFirefoxCaptureTab
  });
}

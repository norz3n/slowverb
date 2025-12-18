/**
 * Slowverb Extension - Firefox Background Script
 * 
 * Firefox MV3 doesn't have tabCapture API, so audio processing
 * happens in the content script via MediaElementSource injection.
 * This background script only coordinates state and messaging.
 */

import { MESSAGE_TYPES } from '../lib/constants.js';
import { loadSettings, saveSettings, resetSettings } from '../lib/settings.js';

/** @type {Map<number, {tabId: number, isProcessing: boolean, url?: string}>} */
const tabStates = new Map();

/** Debounce for storage writes */
let saveDebounceTimer = null;
const SAVE_DEBOUNCE_MS = 500;
let pendingSettings = null;

/**
 * Updates extension badge.
 * @param {boolean} enabled
 * @param {number} [tabId]
 */
async function updateBadge(enabled, tabId) {
  const text = enabled ? 'ON' : '';
  const color = enabled ? '#4CAF50' : '#9E9E9E';
  
  try {
    const opts = tabId ? { text, tabId } : { text };
    await browser.action.setBadgeText(opts);
    await browser.action.setBadgeBackgroundColor({ color, ...(tabId && { tabId }) });
  } catch (e) {
    console.error('[Slowverb Firefox] Badge update failed:', e);
  }
}

/**
 * Ensures content script is injected.
 * @param {number} tabId
 */
async function ensureContentScript(tabId) {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content-firefox.js']
      });
    } catch (e) {
      console.warn('[Slowverb Firefox] Failed to inject content script:', e);
    }
  }
}

/**
 * Handles settings update.
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
async function handleUpdateSettings(payload) {
  try {
    const current = await loadSettings();
    const newSettings = { ...current, ...payload };
    
    // Forward to all active content scripts
    for (const [tabId, state] of tabStates) {
      if (state.isProcessing) {
        try {
          await browser.tabs.sendMessage(tabId, {
            type: 'UPDATE_SETTINGS',
            settings: newSettings
          });
          
          if (payload.speed !== undefined) {
            await browser.tabs.sendMessage(tabId, {
              type: 'SET_SPEED',
              speed: newSettings.speed
            });
          }
        } catch (e) { /* ignore */ }
      }
    }
    
    // Debounced save
    pendingSettings = newSettings;
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(async () => {
      if (pendingSettings) {
        await saveSettings(pendingSettings);
        pendingSettings = null;
      }
    }, SAVE_DEBOUNCE_MS);
    
    return { success: true, settings: newSettings };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handles extension toggle.
 * @param {Object} payload
 * @param {number} tabId
 * @returns {Promise<Object>}
 */
async function handleToggleExtension(payload, tabId) {
  const { enabled, settings: uiSettings } = payload;
  
  try {
    if (uiSettings) {
      await saveSettings(uiSettings);
    } else {
      await saveSettings({ enabled });
    }
    
    await updateBadge(enabled, tabId);
    const settings = await loadSettings();
    
    await ensureContentScript(tabId);
    
    if (enabled) {
      // Get tab URL for tracking
      let tabUrl = null;
      try {
        const tab = await browser.tabs.get(tabId);
        tabUrl = tab.url;
      } catch (e) { /* ignore */ }
      
      tabStates.set(tabId, { tabId, isProcessing: true, url: tabUrl });
      
      // Enable audio processing in content script
      await browser.tabs.sendMessage(tabId, {
        type: 'ENABLE',
        speed: settings.speed,
        settings: {
          reverb: settings.reverb,
          bassBoost: settings.bassBoost
        }
      });
    } else {
      tabStates.delete(tabId);
      
      // Disable audio processing
      try {
        await browser.tabs.sendMessage(tabId, { type: 'DISABLE' });
      } catch (e) { /* ignore */ }
    }
    
    return { success: true, enabled };
  } catch (error) {
    console.error('[Slowverb Firefox] Toggle failed:', error);
    await updateBadge(!enabled, tabId);
    return { success: false, error: error.message };
  }
}

/**
 * Handles settings reset.
 * @returns {Promise<Object>}
 */
async function handleResetSettings() {
  try {
    const defaults = await resetSettings();
    
    // Update all active tabs
    for (const [tabId, state] of tabStates) {
      if (state.isProcessing) {
        try {
          await browser.tabs.sendMessage(tabId, {
            type: 'UPDATE_SETTINGS',
            settings: defaults
          });
        } catch (e) { /* ignore */ }
      }
    }
    
    await updateBadge(false);
    return { success: true, settings: defaults };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handles get settings request.
 * @param {number} tabId
 * @returns {Promise<Object>}
 */
async function handleGetSettings(tabId) {
  try {
    const settings = await loadSettings();
    
    // Check if this tab is actually processing
    const isActive = tabStates.has(tabId) && tabStates.get(tabId).isProcessing;
    if (isActive !== settings.enabled) {
      settings.enabled = isActive;
      if (!isActive) {
        await saveSettings({ enabled: false });
        await updateBadge(false, tabId);
      }
    }
    
    return { success: true, settings };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Main message handler.
 */
function handleMessage(message, sender, sendResponse) {
  console.log('[Slowverb Firefox] Message:', message.type);
  
  const tabId = sender.tab?.id || message.tabId;
  
  (async () => {
    let response;
    
    switch (message.type) {
      case MESSAGE_TYPES.UPDATE_SETTINGS:
        response = await handleUpdateSettings(message.payload);
        break;
        
      case MESSAGE_TYPES.TOGGLE_EXTENSION:
        response = tabId 
          ? await handleToggleExtension(message.payload, tabId)
          : { success: false, error: 'No tab ID' };
        break;
        
      case MESSAGE_TYPES.RESET_SETTINGS:
        response = await handleResetSettings();
        break;
        
      case MESSAGE_TYPES.GET_SETTINGS:
        response = await handleGetSettings(tabId);
        break;
        
      default:
        response = { success: false, error: 'Unknown message type' };
    }
    
    sendResponse(response);
  })();
  
  return true;
}

// Tab cleanup
browser.tabs.onRemoved.addListener(tabId => {
  tabStates.delete(tabId);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!tabStates.has(tabId) || !changeInfo.url) return;
  
  const state = tabStates.get(tabId);
  if (state.url) {
    try {
      const oldOrigin = new URL(state.url).origin;
      const newOrigin = new URL(changeInfo.url).origin;
      
      if (oldOrigin !== newOrigin) {
        tabStates.delete(tabId);
        await updateBadge(false, tabId);
      } else {
        state.url = changeInfo.url;
      }
    } catch (e) { /* ignore */ }
  }
});

browser.runtime.onMessage.addListener(handleMessage);
updateBadge(false);

console.log('[Slowverb Firefox] Background script initialized');

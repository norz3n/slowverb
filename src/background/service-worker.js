/**
 * Slowverb Extension - Service Worker (Background Script)
 * 
 * Central coordinator for the extension. Manages:
 * - Offscreen document lifecycle
 * - Tab audio capture
 * - Message routing between popup and offscreen document
 * - Tab state management
 * 
 * Requirements: 5.4 (badge status), 6.2 (tabCapture with offscreen), 6.4 (resource cleanup)
 */

import { 
  MESSAGE_TYPES, 
  ERROR_CODES, 
  DEFAULT_SETTINGS 
} from '../lib/constants.js';
import { 
  loadSettings, 
  saveSettings, 
  resetSettings 
} from '../lib/settings.js';

/**
 * Path to the offscreen document HTML file.
 * @constant {string}
 */
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';

/**
 * Reason for creating offscreen document (required by Chrome API).
 * @constant {string}
 */
const OFFSCREEN_REASON = 'USER_MEDIA';

/**
 * Justification for offscreen document (required by Chrome API).
 * @constant {string}
 */
const OFFSCREEN_JUSTIFICATION = 'Audio processing for Slowverb extension requires Web Audio API access';

/**
 * Debounce timer for storage writes.
 * @type {number|null}
 */
let saveDebounceTimer = null;

/**
 * Debounce delay for storage writes (ms).
 * Chrome storage.sync allows ~120 writes/minute.
 */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Pending settings to save after debounce.
 * @type {Object|null}
 */
let pendingSettings = null;

/**
 * Tab state storage - tracks active tabs with audio processing.
 * @type {Map<number, TabState>}
 */
const tabStates = new Map();

/**
 * @typedef {Object} TabState
 * @property {number} tabId - Tab identifier
 * @property {boolean} isProcessing - Whether audio is being processed
 * @property {string|null} streamId - Tab capture stream ID
 * @property {Object} settings - Current settings for this tab
 */

// ============================================================================
// Offscreen Document Management (Task 9.1)
// ============================================================================


/**
 * Checks if an offscreen document already exists.
 * Uses chrome.runtime.getContexts API (Manifest V3).
 * 
 * @returns {Promise<boolean>} True if offscreen document exists
 */
async function hasOffscreenDocument() {
  // Check for existing offscreen document contexts
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });
  
  return contexts.length > 0;
}

/**
 * Ensures an offscreen document exists, creating one if necessary.
 * Checks for existing contexts before creation to avoid duplicates.
 * 
 * Requirements: 6.2 (tabCapture with offscreen document)
 * 
 * @returns {Promise<void>}
 * @throws {Error} If offscreen document creation fails
 */
async function ensureOffscreenDocument() {
  // Check if offscreen document already exists
  const exists = await hasOffscreenDocument();
  
  if (exists) {
    console.log('[Slowverb] Offscreen document already exists');
    return;
  }
  
  // Create new offscreen document
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [OFFSCREEN_REASON],
      justification: OFFSCREEN_JUSTIFICATION
    });
    
    console.log('[Slowverb] Offscreen document created');
  } catch (error) {
    // Handle case where document was created between check and create
    if (error.message?.includes('Only a single offscreen')) {
      console.log('[Slowverb] Offscreen document already exists (race condition)');
      return;
    }
    
    console.error('[Slowverb] Failed to create offscreen document:', error);
    throw error;
  }
}

/**
 * Closes the offscreen document if it exists.
 * Used for cleanup when extension is disabled or all tabs are closed.
 * 
 * @returns {Promise<void>}
 */
async function closeOffscreenDocument() {
  const exists = await hasOffscreenDocument();
  
  if (!exists) {
    return;
  }
  
  try {
    await chrome.offscreen.closeDocument();
    console.log('[Slowverb] Offscreen document closed');
  } catch (error) {
    console.error('[Slowverb] Failed to close offscreen document:', error);
  }
}

// ============================================================================
// Tab Capture Management (Task 9.2)
// ============================================================================

/**
 * Starts audio capture for a specific tab.
 * Gets stream ID from tabCapture API and sends to offscreen document.
 * 
 * Requirements: 6.2 (tabCapture API with offscreen document)
 * 
 * @param {number} tabId - ID of the tab to capture
 * @returns {Promise<void>}
 * @throws {Error} If capture fails
 */
async function startAudioCapture(tabId) {
  try {
    // Ensure offscreen document exists
    await ensureOffscreenDocument();
    
    // Get current settings
    const settings = await loadSettings();
    
    // Get stream ID from tabCapture API
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });
    
    if (!streamId) {
      throw new Error('Failed to get media stream ID');
    }
    
    // Get current tab URL for SPA navigation detection
    let tabUrl = null;
    try {
      const tab = await chrome.tabs.get(tabId);
      tabUrl = tab.url;
    } catch (e) {
      // Ignore - URL is optional
    }
    
    // Update tab state
    tabStates.set(tabId, {
      tabId,
      isProcessing: true,
      streamId,
      settings,
      url: tabUrl
    });
    
    // Send start capture message to offscreen document
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.START_CAPTURE,
      streamId,
      settings
    });
    
    if (!response?.success) {
      // Cleanup on failure
      tabStates.delete(tabId);
      throw new Error(response?.error || 'Failed to start capture');
    }
    
    console.log('[Slowverb] Audio capture started for tab:', tabId);
  } catch (error) {
    console.error('[Slowverb] Failed to start audio capture:', error);
    tabStates.delete(tabId);
    throw error;
  }
}

/**
 * Stops audio capture for a specific tab.
 * Sends stop message to offscreen document and cleans up state.
 * 
 * Requirements: 6.4 (release audio resources)
 * 
 * @param {number} tabId - ID of the tab to stop capturing
 * @returns {Promise<void>}
 */
async function stopAudioCapture(tabId) {
  const tabState = tabStates.get(tabId);
  
  if (!tabState) {
    console.log('[Slowverb] No active capture for tab:', tabId);
    return;
  }
  
  try {
    // Send stop capture message to offscreen document
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.STOP_CAPTURE
    });
    
    console.log('[Slowverb] Audio capture stopped for tab:', tabId);
  } catch (error) {
    console.error('[Slowverb] Error stopping capture:', error);
  } finally {
    // Always clean up tab state
    tabStates.delete(tabId);
    
    // Close offscreen document if no more active tabs
    if (tabStates.size === 0) {
      await closeOffscreenDocument();
    }
  }
}

// ============================================================================
// Message Handling (Task 9.3)
// ============================================================================

/**
 * Updates the extension badge to indicate active/inactive status.
 * 
 * Requirements: 5.4 (indicate active status through badge)
 * 
 * @param {boolean} enabled - Whether the extension is enabled
 * @param {number} [tabId] - Optional tab ID for tab-specific badge
 */
async function updateBadge(enabled, tabId) {
  const badgeText = enabled ? 'ON' : '';
  const badgeColor = enabled ? '#4CAF50' : '#9E9E9E';
  
  try {
    if (tabId) {
      await chrome.action.setBadgeText({ text: badgeText, tabId });
      await chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId });
    } else {
      await chrome.action.setBadgeText({ text: badgeText });
      await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    }
  } catch (error) {
    console.error('[Slowverb] Failed to update badge:', error);
  }
}

/**
 * Forwards settings update to the offscreen document.
 * 
 * @param {Object} settings - Settings to forward
 * @returns {Promise<void>}
 */
async function forwardSettingsToOffscreen(settings) {
  const exists = await hasOffscreenDocument();
  
  if (!exists) {
    return;
  }
  
  try {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.UPDATE_AUDIO,
      settings
    });
  } catch (error) {
    console.error('[Slowverb] Failed to forward settings:', error);
  }
}

/**
 * Handles UPDATE_SETTINGS message from popup.
 * Saves settings and forwards to offscreen document.
 * 
 * @param {Object} payload - Partial settings to update
 * @returns {Promise<Object>} Response object
 */
async function handleUpdateSettings(payload) {
  try {
    // Load current settings and merge with updates
    const currentSettings = await loadSettings();
    const newSettings = { ...currentSettings, ...payload };
    
    // Forward to offscreen document IMMEDIATELY for real-time audio
    await forwardSettingsToOffscreen(newSettings);
    
    // Send speed/pitchCorrection to content scripts IMMEDIATELY
    for (const [tabId, state] of tabStates) {
      state.settings = newSettings;
      tabStates.set(tabId, state);
      
      if (payload.speed !== undefined) {
        try {
          await chrome.tabs.sendMessage(tabId, {
            type: 'SET_SPEED',
            speed: newSettings.speed
          });
        } catch (e) {
          // Content script may not be loaded yet
        }
      }
    }
    
    // Debounce storage write to avoid rate limit
    pendingSettings = newSettings;
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
    }
    saveDebounceTimer = setTimeout(async () => {
      if (pendingSettings) {
        try {
          await saveSettings(pendingSettings);
        } catch (e) {
          console.error('[Slowverb] Debounced save failed:', e);
        }
        pendingSettings = null;
      }
    }, SAVE_DEBOUNCE_MS);
    
    return { success: true, settings: newSettings };
  } catch (error) {
    console.error('[Slowverb] Failed to update settings:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Ensures content script is injected into the tab.
 * Needed for tabs that were open before extension was installed/enabled.
 * 
 * @param {number} tabId - Tab ID to inject into
 * @returns {Promise<boolean>} True if injection succeeded or script already present
 */
async function ensureContentScript(tabId) {
  try {
    // Try to ping the content script first
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true; // Script already loaded
  } catch {
    // Content script not loaded, inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content.js']
      });
      console.log('[Slowverb] Content script injected into tab:', tabId);
      return true;
    } catch (error) {
      console.warn('[Slowverb] Failed to inject content script:', error);
      return false;
    }
  }
}

/**
 * Handles TOGGLE_EXTENSION message from popup.
 * Starts or stops audio capture based on enabled state.
 * 
 * @param {Object} payload - Contains enabled boolean
 * @param {number} tabId - Current tab ID
 * @returns {Promise<Object>} Response object
 */
async function handleToggleExtension(payload, tabId) {
  const { enabled, settings: uiSettings } = payload;
  
  try {
    // Если переданы настройки из UI, сохраняем их
    if (uiSettings) {
      await saveSettings(uiSettings);
    } else {
      await saveSettings({ enabled });
    }
    
    // Update badge
    await updateBadge(enabled, tabId);
    
    // Загружаем актуальные настройки (включая переданные из UI)
    const settings = await loadSettings();
    
    if (enabled) {
      // Always close offscreen document first to release any active stream
      // This prevents "Cannot capture a tab with an active stream" error
      // even if tabStates is out of sync
      const hasOffscreen = await hasOffscreenDocument();
      if (hasOffscreen) {
        await closeOffscreenDocument();
        // Delay to ensure Chrome fully releases the stream
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      // Clear any stale tab states
      tabStates.clear();
      
      // Ensure content script is loaded (for tabs opened before extension)
      await ensureContentScript(tabId);
      
      // Start audio capture for current tab (settings будут применены внутри)
      await startAudioCapture(tabId);
      
      // Enable playback rate control in content script
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'ENABLE',
          speed: settings.speed
        });
      } catch (e) {
        console.warn('[Slowverb] Could not send ENABLE to content script:', e);
      }
    } else {
      // IMPORTANT: Close offscreen document FIRST to release the stream
      // This must happen before any other cleanup to avoid "active stream" error
      await closeOffscreenDocument();
      
      // Small delay to ensure Chrome fully releases the stream
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Clear all tab states
      tabStates.clear();
      
      // Disable playback rate control in content script
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'DISABLE'
        });
      } catch (e) {
        // Content script may not be loaded
      }
    }
    
    return { success: true, enabled };
  } catch (error) {
    console.error('[Slowverb] Failed to toggle extension:', error);
    // Revert badge on failure
    await updateBadge(!enabled, tabId);
    return { success: false, error: error.message };
  }
}

/**
 * Handles RESET_SETTINGS message from popup.
 * Resets all settings to defaults.
 * 
 * @returns {Promise<Object>} Response object with default settings
 */
async function handleResetSettings() {
  try {
    const defaults = await resetSettings();
    
    // Forward to offscreen document
    await forwardSettingsToOffscreen(defaults);
    
    // Update badge (extension disabled by default)
    await updateBadge(false);
    
    return { success: true, settings: defaults };
  } catch (error) {
    console.error('[Slowverb] Failed to reset settings:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handles GET_SETTINGS message from popup.
 * Returns current settings with actual enabled state based on active capture.
 * 
 * @param {number} tabId - Current tab ID to check capture state
 * @returns {Promise<Object>} Response object with settings
 */
async function handleGetSettings(tabId) {
  try {
    const settings = await loadSettings();
    
    // Проверяем реальное состояние capture для текущей вкладки
    // Если capture не активен, enabled должен быть false
    if (tabId && settings.enabled && !tabStates.has(tabId)) {
      settings.enabled = false;
      // Обновляем storage чтобы синхронизировать состояние
      await saveSettings({ enabled: false });
      await updateBadge(false, tabId);
    }
    
    return { success: true, settings };
  } catch (error) {
    console.error('[Slowverb] Failed to get settings:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Flag to prevent concurrent recapture attempts.
 * @type {boolean}
 */
let isRecapturing = false;

/**
 * Handles STREAM_ENDED message from offscreen document.
 * Attempts to recapture audio when stream ends (e.g., YouTube SPA navigation).
 * Uses lock to prevent concurrent recapture attempts.
 * 
 * @returns {Promise<void>}
 */
async function handleStreamEnded() {
  // Prevent concurrent recapture attempts
  if (isRecapturing) {
    console.log('[Slowverb] Recapture already in progress, skipping');
    return;
  }
  
  console.log('[Slowverb] Stream ended, attempting recapture...');
  isRecapturing = true;
  
  try {
    // Find the active tab that had capture
    for (const [tabId, state] of tabStates) {
      if (state.isProcessing) {
        console.log('[Slowverb] Recapturing tab:', tabId);
        
        // Clean up old state
        tabStates.delete(tabId);
        
        // IMPORTANT: Close offscreen document to release the stream
        // This prevents "Cannot capture a tab with an active stream" error
        await closeOffscreenDocument();
        
        // Delay to let Chrome fully release the stream
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          // Recapture with current settings
          await startAudioCapture(tabId);
          
          // Re-enable content script
          const settings = await loadSettings();
          try {
            await chrome.tabs.sendMessage(tabId, {
              type: 'ENABLE',
              speed: settings.speed
            });
          } catch (e) {
            // Content script may need re-injection
            await ensureContentScript(tabId);
            await chrome.tabs.sendMessage(tabId, {
              type: 'ENABLE',
              speed: settings.speed
            });
          }
          
          console.log('[Slowverb] Recapture successful');
        } catch (error) {
          console.error('[Slowverb] Recapture failed:', error);
          await updateBadge(false, tabId);
          // Save disabled state
          await saveSettings({ enabled: false });
        }
        
        break; // Only one active capture at a time
      }
    }
  } finally {
    isRecapturing = false;
  }
}

/**
 * Main message handler for messages from popup.
 * Routes messages to appropriate handlers.
 * 
 * Requirements: 5.4 (badge), 6.2 (offscreen communication)
 * 
 * @param {Object} message - Message object with type and payload
 * @param {Object} sender - Message sender info
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} True for async response
 */
function handleMessage(message, sender, sendResponse) {
  console.log('[Slowverb] Service worker received message:', message.type);
  
  // Get tab ID from sender or message
  const tabId = sender.tab?.id || message.tabId;
  
  (async () => {
    let response;
    
    try {
      switch (message.type) {
        case MESSAGE_TYPES.UPDATE_SETTINGS:
          response = await handleUpdateSettings(message.payload);
          break;
          
        case MESSAGE_TYPES.TOGGLE_EXTENSION:
          if (!tabId) {
            response = { success: false, error: 'No tab ID provided' };
          } else {
            response = await handleToggleExtension(message.payload, tabId);
          }
          break;
          
        case MESSAGE_TYPES.RESET_SETTINGS:
          response = await handleResetSettings();
          break;
          
        case MESSAGE_TYPES.GET_SETTINGS:
          response = await handleGetSettings(tabId);
          break;
          
        case MESSAGE_TYPES.STREAM_ENDED:
          // Handle stream ended from offscreen document
          await handleStreamEnded();
          response = { success: true };
          break;
          
        case 'MEDIA_CHANGED':
          // Handle media source change from content script (YouTube video switch)
          if (tabId && tabStates.has(tabId)) {
            console.log('[Slowverb] Media changed in tab:', tabId);
            await handleStreamEnded();
          }
          response = { success: true };
          break;
          
        default:
          console.warn('[Slowverb] Unknown message type:', message.type);
          response = { success: false, error: 'Unknown message type' };
      }
    } catch (error) {
      console.error('[Slowverb] Error handling message:', error);
      response = { success: false, error: ERROR_CODES.UNKNOWN_ERROR };
    }
    
    sendResponse(response);
  })();
  
  return true; // Async response
}

// ============================================================================
// Tab State Management (Task 9.4)
// ============================================================================

/**
 * Handles tab removal event.
 * Cleans up audio processing when a tab is closed.
 * 
 * Requirements: 6.4 (release audio resources on navigation)
 * 
 * @param {number} tabId - ID of the removed tab
 */
async function handleTabRemoved(tabId) {
  if (tabStates.has(tabId)) {
    console.log('[Slowverb] Tab closed, stopping capture:', tabId);
    await stopAudioCapture(tabId);
  }
}

/**
 * Handles tab update event.
 * Stops audio processing only when navigating to a different origin.
 * SPA navigation (like YouTube) keeps the same origin and should not stop capture.
 * 
 * Requirements: 6.4 (release audio resources on navigation)
 * 
 * @param {number} tabId - ID of the updated tab
 * @param {Object} changeInfo - Information about the change
 * @param {Object} tab - Tab object with URL info
 */
async function handleTabUpdated(tabId, changeInfo, tab) {
  // Реагируем только на навигацию на ДРУГОЙ домен
  // Для SPA сайтов (YouTube, SoundCloud и т.д.) capture должен продолжать работать
  if (!tabStates.has(tabId)) return;
  
  // changeInfo.url присутствует только при реальной навигации
  if (changeInfo.url) {
    const tabState = tabStates.get(tabId);
    const oldUrl = tabState.url;
    
    // Проверяем, изменился ли origin (домен)
    try {
      if (oldUrl) {
        const oldOrigin = new URL(oldUrl).origin;
        const newOrigin = new URL(changeInfo.url).origin;
        
        // Если origin тот же — это SPA навигация, продолжаем работать
        if (oldOrigin === newOrigin) {
          console.log('[Slowverb] Same-origin navigation, keeping capture');
          tabState.url = changeInfo.url;
          return;
        }
        
        // Origin изменился — останавливаем capture
        console.log('[Slowverb] Cross-origin navigation, stopping capture');
        await stopAudioCapture(tabId);
        await updateBadge(false, tabId);
      }
    } catch (e) {
      // Ошибка парсинга URL — игнорируем
    }
  }
}

/**
 * Gets the current state of a tab.
 * 
 * @param {number} tabId - Tab ID to check
 * @returns {TabState|null} Tab state or null if not active
 */
function getTabState(tabId) {
  return tabStates.get(tabId) || null;
}

/**
 * Checks if a tab has active audio processing.
 * 
 * @param {number} tabId - Tab ID to check
 * @returns {boolean} True if tab has active processing
 */
function isTabActive(tabId) {
  const state = tabStates.get(tabId);
  return state?.isProcessing || false;
}

// ============================================================================
// Event Listeners Setup
// ============================================================================

// Listen for messages from popup and offscreen document
chrome.runtime.onMessage.addListener(handleMessage);

// Listen for tab removal
chrome.tabs.onRemoved.addListener(handleTabRemoved);

// Listen for tab updates (navigation)
chrome.tabs.onUpdated.addListener(handleTabUpdated);

// Initialize badge on service worker start
updateBadge(false);

console.log('[Slowverb] Service worker initialized');

// ============================================================================
// Exports (for testing)
// ============================================================================

export {
  // Offscreen document management
  hasOffscreenDocument,
  ensureOffscreenDocument,
  closeOffscreenDocument,
  
  // Tab capture
  startAudioCapture,
  stopAudioCapture,
  
  // Message handling
  handleMessage,
  handleUpdateSettings,
  handleToggleExtension,
  handleResetSettings,
  handleGetSettings,
  handleStreamEnded,
  updateBadge,
  forwardSettingsToOffscreen,
  
  // Tab state management
  tabStates,
  handleTabRemoved,
  handleTabUpdated,
  getTabState,
  isTabActive
};

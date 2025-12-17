/**
 * Slowverb Extension - Popup Script
 * 
 * UI component for controlling audio effects.
 * Handles user interactions and communicates with service worker.
 * 
 * Requirements: 5.1 (popup controls), 5.2 (real-time changes), 7.2 (restore settings)
 */

import { 
  MESSAGE_TYPES, 
  DEFAULT_SETTINGS, 
  CONSTRAINTS 
} from '../lib/constants.js';
import { formatSpeedDisplay } from '../lib/audio-utils.js';

/**
 * UI element references.
 * @type {Object}
 */
const elements = {
  enableToggle: null,
  speedSlider: null,
  speedValue: null,
  reverbSlider: null,
  reverbValue: null,
  bassBoostSlider: null,
  bassBoostValue: null,
  pitchCorrectionToggle: null,
  resetButton: null
};

/**
 * Current settings state.
 * @type {Object}
 */
let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Debounce timer for settings save.
 * @type {number|null}
 */
let saveDebounceTimer = null;

/**
 * Debounce delay in milliseconds.
 * Chrome storage.sync allows ~120 writes per minute, so ~500ms debounce is safe.
 */
const SAVE_DEBOUNCE_MS = 300;

// ============================================================================
// Communication with Service Worker
// ============================================================================

/**
 * Sends a message to the service worker.
 * 
 * @param {Object} message - Message to send
 * @returns {Promise<Object>} Response from service worker
 */
async function sendToBackground(message) {
  try {
    // Get current tab ID for toggle operations
    if (message.type === MESSAGE_TYPES.TOGGLE_EXTENSION) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        message.tabId = tab.id;
      }
    }
    
    const response = await chrome.runtime.sendMessage(message);
    return response;
  } catch (error) {
    console.error('[Slowverb Popup] Failed to send message:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Settings Management
// ============================================================================

/**
 * Loads settings from storage via service worker.
 * Restores previously saved settings to UI.
 * 
 * Requirements: 7.2 (restore previously saved settings)
 * 
 * @returns {Promise<void>}
 */
async function loadSettings() {
  const response = await sendToBackground({
    type: MESSAGE_TYPES.GET_SETTINGS
  });
  
  if (response?.success && response.settings) {
    currentSettings = response.settings;
    updateUI(currentSettings);
  } else {
    // Use defaults if loading fails
    console.warn('[Slowverb Popup] Failed to load settings, using defaults');
    currentSettings = { ...DEFAULT_SETTINGS };
    updateUI(currentSettings);
  }
}

/**
 * Saves a partial settings update.
 * Sends update to service worker for persistence and audio processing.
 * 
 * Requirements: 5.2 (apply changes in real-time)
 * 
 * @param {Object} partialSettings - Settings to update
 * @returns {Promise<void>}
 */
async function saveSettings(partialSettings) {
  // Update local state immediately for responsive UI
  currentSettings = { ...currentSettings, ...partialSettings };
  
  // Send to background immediately for real-time updates (audio + content script)
  // But debounce the storage write
  sendToBackground({
    type: MESSAGE_TYPES.UPDATE_SETTINGS,
    payload: partialSettings
  }).catch(err => {
    console.error('[Slowverb Popup] Failed to send settings:', err);
  });
}

/**
 * Resets all settings to default values.
 * 
 * Requirements: 7.3 (reset to defaults)
 * 
 * @returns {Promise<void>}
 */
async function resetToDefaults() {
  const response = await sendToBackground({
    type: MESSAGE_TYPES.RESET_SETTINGS
  });
  
  if (response?.success && response.settings) {
    currentSettings = response.settings;
    updateUI(currentSettings);
  } else {
    console.error('[Slowverb Popup] Failed to reset settings:', response?.error);
  }
}

/**
 * Toggles the extension enabled state.
 * 
 * @param {boolean} enabled - New enabled state
 * @returns {Promise<void>}
 */
async function toggleExtension(enabled) {
  currentSettings.enabled = enabled;
  
  const response = await sendToBackground({
    type: MESSAGE_TYPES.TOGGLE_EXTENSION,
    payload: { enabled }
  });
  
  if (!response?.success) {
    // Revert UI on failure
    currentSettings.enabled = !enabled;
    elements.enableToggle.checked = !enabled;
    console.error('[Slowverb Popup] Failed to toggle extension:', response?.error);
  }
}

// ============================================================================
// UI Updates
// ============================================================================

/**
 * Updates all UI elements to reflect current settings.
 * Syncs sliders, checkboxes, and value displays.
 * 
 * @param {Object} settings - Settings to display
 */
function updateUI(settings) {
  // Enable toggle
  if (elements.enableToggle) {
    elements.enableToggle.checked = settings.enabled;
  }
  
  // Speed slider and value
  if (elements.speedSlider) {
    elements.speedSlider.value = settings.speed;
  }
  if (elements.speedValue) {
    elements.speedValue.textContent = formatSpeedDisplay(settings.speed);
  }
  
  // Reverb slider and value
  if (elements.reverbSlider) {
    elements.reverbSlider.value = settings.reverb;
  }
  if (elements.reverbValue) {
    elements.reverbValue.textContent = `${Math.round(settings.reverb)}%`;
  }
  
  // Bass boost slider and value
  if (elements.bassBoostSlider) {
    elements.bassBoostSlider.value = settings.bassBoost;
  }
  if (elements.bassBoostValue) {
    elements.bassBoostValue.textContent = `${Math.round(settings.bassBoost)}%`;
  }
  
  // Pitch correction toggle
  if (elements.pitchCorrectionToggle) {
    elements.pitchCorrectionToggle.checked = settings.pitchCorrection;
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Rounds a value to the nearest step.
 * 
 * @param {number} value - Value to round
 * @param {number} step - Step size
 * @returns {number} Rounded value
 */
function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

/**
 * Handles speed slider change.
 * Updates display and sends to background.
 * Rounds to step of 0.05 to avoid floating point issues.
 * 
 * @param {Event} event - Input event
 */
function handleSpeedChange(event) {
  // Округляем до шага 0.05 для избежания значений типа 0.8500000001
  const rawSpeed = parseFloat(event.target.value);
  const speed = roundToStep(rawSpeed, CONSTRAINTS.speed.step);
  
  // Синхронизируем слайдер с округлённым значением
  event.target.value = speed;
  
  // Update display immediately
  if (elements.speedValue) {
    elements.speedValue.textContent = formatSpeedDisplay(speed);
  }
  
  // Save setting
  saveSettings({ speed });
}

/**
 * Handles reverb slider change.
 * 
 * @param {Event} event - Input event
 */
function handleReverbChange(event) {
  const reverb = parseInt(event.target.value, 10);
  
  // Update display immediately
  if (elements.reverbValue) {
    elements.reverbValue.textContent = `${reverb}%`;
  }
  
  // Save setting
  saveSettings({ reverb });
}

/**
 * Handles bass boost slider change.
 * 
 * @param {Event} event - Input event
 */
function handleBassBoostChange(event) {
  const bassBoost = parseInt(event.target.value, 10);
  
  // Update display immediately
  if (elements.bassBoostValue) {
    elements.bassBoostValue.textContent = `${bassBoost}%`;
  }
  
  // Save setting
  saveSettings({ bassBoost });
}

/**
 * Handles pitch correction toggle change.
 * 
 * @param {Event} event - Change event
 */
function handlePitchCorrectionChange(event) {
  const pitchCorrection = event.target.checked;
  saveSettings({ pitchCorrection });
}

/**
 * Handles enable toggle change.
 * 
 * @param {Event} event - Change event
 */
function handleEnableToggleChange(event) {
  const enabled = event.target.checked;
  toggleExtension(enabled);
}

/**
 * Handles reset button click.
 */
function handleResetClick() {
  resetToDefaults();
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initializes UI by caching element references and setting up event listeners.
 * 
 * Requirements: 5.1 (popup with all controls)
 */
function initializeUI() {
  // Cache element references
  elements.enableToggle = document.getElementById('enableToggle');
  elements.speedSlider = document.getElementById('speedSlider');
  elements.speedValue = document.getElementById('speedValue');
  elements.reverbSlider = document.getElementById('reverbSlider');
  elements.reverbValue = document.getElementById('reverbValue');
  elements.bassBoostSlider = document.getElementById('bassBoostSlider');
  elements.bassBoostValue = document.getElementById('bassBoostValue');
  elements.pitchCorrectionToggle = document.getElementById('pitchCorrectionToggle');
  elements.resetButton = document.getElementById('resetButton');
  
  // Set up event listeners
  if (elements.enableToggle) {
    elements.enableToggle.addEventListener('change', handleEnableToggleChange);
  }
  
  if (elements.speedSlider) {
    elements.speedSlider.addEventListener('input', handleSpeedChange);
  }
  
  if (elements.reverbSlider) {
    elements.reverbSlider.addEventListener('input', handleReverbChange);
  }
  
  if (elements.bassBoostSlider) {
    elements.bassBoostSlider.addEventListener('input', handleBassBoostChange);
  }
  
  if (elements.pitchCorrectionToggle) {
    elements.pitchCorrectionToggle.addEventListener('change', handlePitchCorrectionChange);
  }
  
  if (elements.resetButton) {
    elements.resetButton.addEventListener('click', handleResetClick);
  }
}

/**
 * Main initialization function.
 * Sets up UI and loads saved settings.
 */
async function init() {
  initializeUI();
  await loadSettings();
  console.log('[Slowverb Popup] Initialized');
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

// ============================================================================
// Exports (for testing)
// ============================================================================

export {
  elements,
  currentSettings,
  sendToBackground,
  loadSettings,
  saveSettings,
  resetToDefaults,
  toggleExtension,
  updateUI,
  initializeUI,
  handleSpeedChange,
  handleReverbChange,
  handleBassBoostChange,
  handlePitchCorrectionChange,
  handleEnableToggleChange,
  handleResetClick
};

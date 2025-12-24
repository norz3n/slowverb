/**
 * Slowverb Extension - Settings Storage Functions
 * 
 * Provides functions for persisting, loading, and validating settings.
 * Uses Chrome storage.sync API for cross-device synchronization.
 * 
 * Requirements: 7.1 (persist settings), 7.2 (restore settings), 7.3 (reset to defaults)
 */

import { DEFAULT_SETTINGS, CONSTRAINTS, ERROR_CODES, BUILTIN_PRESETS } from './constants.js';

/**
 * Storage key for settings in Chrome storage.
 * @constant {string}
 */
const STORAGE_KEY = 'slowverb_settings';

/**
 * Validates and clamps settings values to their valid ranges.
 * Ensures all numeric values are within CONSTRAINTS bounds.
 * Boolean values are coerced to boolean type.
 * 
 * @param {Object} settings - Settings object to validate
 * @returns {Object} Validated settings with clamped values
 */
export function validateSettings(settings) {
  const validated = {};
  
  // Validate speed (0.5 - 1.5)
  if (settings.speed !== undefined) {
    const speed = Number(settings.speed);
    if (!Number.isNaN(speed)) {
      validated.speed = Math.max(
        CONSTRAINTS.speed.min,
        Math.min(CONSTRAINTS.speed.max, speed)
      );
    }
  }
  
  // Validate reverb (0 - 100)
  if (settings.reverb !== undefined) {
    const reverb = Number(settings.reverb);
    if (!Number.isNaN(reverb)) {
      validated.reverb = Math.max(
        CONSTRAINTS.reverb.min,
        Math.min(CONSTRAINTS.reverb.max, reverb)
      );
    }
  }
  
  // Validate bassBoost (0 - 100)
  if (settings.bassBoost !== undefined) {
    const bassBoost = Number(settings.bassBoost);
    if (!Number.isNaN(bassBoost)) {
      validated.bassBoost = Math.max(
        CONSTRAINTS.bassBoost.min,
        Math.min(CONSTRAINTS.bassBoost.max, bassBoost)
      );
    }
  }

  // Validate enabled (boolean)
  if (settings.enabled !== undefined) {
    validated.enabled = Boolean(settings.enabled);
  }
  
  // Validate activePreset (string or null)
  if (settings.activePreset !== undefined) {
    validated.activePreset = settings.activePreset;
  }
  
  // Validate preservePitch (boolean)
  if (settings.preservePitch !== undefined) {
    validated.preservePitch = Boolean(settings.preservePitch);
  }
  
  return validated;
}

/**
 * Merges partial settings with defaults to create a complete settings object.
 * Validates all values before merging.
 * 
 * @param {Object} partialSettings - Partial settings to merge
 * @returns {Object} Complete settings object with all fields
 */
function mergeWithDefaults(partialSettings) {
  const validated = validateSettings(partialSettings);
  return {
    ...DEFAULT_SETTINGS,
    ...validated
  };
}

/**
 * Saves settings to Chrome storage.sync.
 * Validates settings before saving.
 * 
 * Property 7: Settings round-trip persistence
 * Validates: Requirements 7.1
 * 
 * @param {Object} settings - Settings object to save
 * @returns {Promise<void>} Resolves when settings are saved
 * @throws {Error} If saving fails
 */
export async function saveSettings(settings) {
  try {
    // Validate and merge with defaults to ensure complete object
    const validatedSettings = mergeWithDefaults(settings);
    
    await chrome.storage.sync.set({
      [STORAGE_KEY]: validatedSettings
    });
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw new Error(ERROR_CODES.SETTINGS_SAVE_FAILED);
  }
}

/**
 * Loads settings from Chrome storage.sync.
 * Returns default settings if no saved settings exist.
 * 
 * Property 7: Settings round-trip persistence
 * Validates: Requirements 7.2
 * 
 * @returns {Promise<Object>} Loaded settings object
 * @throws {Error} If loading fails
 */
export async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    
    // If no settings saved, return defaults
    if (!result[STORAGE_KEY]) {
      return { ...DEFAULT_SETTINGS };
    }
    
    // Validate loaded settings and merge with defaults
    // This handles cases where saved settings are incomplete or corrupted
    return mergeWithDefaults(result[STORAGE_KEY]);
  } catch (error) {
    console.error('Failed to load settings:', error);
    throw new Error(ERROR_CODES.SETTINGS_LOAD_FAILED);
  }
}

/**
 * Resets settings to default values and saves to storage.
 * 
 * Property 8: Settings reset to defaults
 * Validates: Requirements 7.3
 * 
 * @returns {Promise<Object>} Default settings object
 * @throws {Error} If saving fails
 */
export async function resetSettings() {
  const defaults = { ...DEFAULT_SETTINGS };
  
  try {
    await chrome.storage.sync.set({
      [STORAGE_KEY]: defaults
    });
    
    return defaults;
  } catch (error) {
    console.error('Failed to reset settings:', error);
    throw new Error(ERROR_CODES.SETTINGS_SAVE_FAILED);
  }
}

/**
 * Storage key for custom presets.
 * @constant {string}
 */
const PRESETS_KEY = 'slowverb_presets';

/**
 * Loads all presets (builtin + custom).
 * 
 * @returns {Promise<Object.<string, Preset>>} All presets
 */
export async function loadPresets() {
  try {
    const result = await chrome.storage.sync.get(PRESETS_KEY);
    const customPresets = result[PRESETS_KEY] || {};
    
    // Merge builtin with custom (custom can override builtin names but not IDs)
    return { ...BUILTIN_PRESETS, ...customPresets };
  } catch (error) {
    console.error('Failed to load presets:', error);
    return { ...BUILTIN_PRESETS };
  }
}

/**
 * Saves a custom preset.
 * 
 * @param {Object} preset - Preset to save
 * @param {string} preset.name - Display name
 * @param {number} preset.speed - Speed value
 * @param {number} preset.reverb - Reverb value
 * @param {number} preset.bassBoost - Bass boost value
 * @returns {Promise<Object>} Saved preset with generated ID
 */
export async function savePreset(preset) {
  try {
    const result = await chrome.storage.sync.get(PRESETS_KEY);
    const customPresets = result[PRESETS_KEY] || {};
    
    // Generate unique ID for new preset
    const id = preset.id || `custom-${Date.now()}`;
    
    const newPreset = {
      id,
      name: preset.name,
      speed: preset.speed,
      reverb: preset.reverb,
      bassBoost: preset.bassBoost,
      builtin: false
    };
    
    customPresets[id] = newPreset;
    
    await chrome.storage.sync.set({ [PRESETS_KEY]: customPresets });
    
    return newPreset;
  } catch (error) {
    console.error('Failed to save preset:', error);
    throw new Error(ERROR_CODES.SETTINGS_SAVE_FAILED);
  }
}

/**
 * Deletes a custom preset.
 * Cannot delete builtin presets.
 * 
 * @param {string} presetId - ID of preset to delete
 * @returns {Promise<boolean>} True if deleted
 */
export async function deletePreset(presetId) {
  // Cannot delete builtin presets
  if (BUILTIN_PRESETS[presetId]) {
    return false;
  }
  
  try {
    const result = await chrome.storage.sync.get(PRESETS_KEY);
    const customPresets = result[PRESETS_KEY] || {};
    
    if (customPresets[presetId]) {
      delete customPresets[presetId];
      await chrome.storage.sync.set({ [PRESETS_KEY]: customPresets });
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Failed to delete preset:', error);
    return false;
  }
}

/**
 * Applies a preset to current settings.
 * 
 * @param {string} presetId - ID of preset to apply
 * @returns {Promise<Object|null>} New settings or null if preset not found
 */
export async function applyPreset(presetId) {
  const presets = await loadPresets();
  const preset = presets[presetId];
  
  if (!preset) {
    return null;
  }
  
  const currentSettings = await loadSettings();
  const newSettings = {
    ...currentSettings,
    speed: preset.speed,
    reverb: preset.reverb,
    bassBoost: preset.bassBoost,
    activePreset: presetId
  };
  
  await saveSettings(newSettings);
  return newSettings;
}

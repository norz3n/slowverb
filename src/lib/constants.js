/**
 * Slowverb Extension - Constants and Default Settings
 * 
 * Defines all constants, default values, and constraints for the extension.
 * Requirements: 7.3 (default values for reset functionality)
 */

/**
 * Default settings for the extension.
 * Used when initializing or resetting settings.
 * 
 * @type {Object}
 * @property {number} speed - Playback rate (1.0 = normal speed)
 * @property {number} reverb - Reverb wet/dry percentage (0-100)
 * @property {number} bassBoost - Bass boost percentage (0-100)
 * @property {boolean} enabled - Whether the extension is active
 * @property {string|null} activePreset - Currently active preset ID or null
 */
export const DEFAULT_SETTINGS = {
  speed: 1.0,
  reverb: 0,
  bassBoost: 0,
  enabled: false,
  activePreset: null
};

/**
 * Built-in presets that cannot be deleted.
 * @type {Object.<string, Preset>}
 */
export const BUILTIN_PRESETS = {
  'slowed-reverb': {
    id: 'slowed-reverb',
    name: 'Slowed & Reverb',
    speed: 0.8,
    reverb: 40,
    bassBoost: 0,
    builtin: true
  },
  'nightcore': {
    id: 'nightcore',
    name: 'Nightcore',
    speed: 1.2,
    reverb: 0,
    bassBoost: 0,
    builtin: true
  },
  'off': {
    id: 'off',
    name: 'OFF',
    speed: 1.0,
    reverb: 0,
    bassBoost: 0,
    builtin: true
  }
};

/**
 * Validation constraints for settings values.
 * Defines min, max, and step for each numeric setting.
 */
export const CONSTRAINTS = {
  speed: { 
    min: 0.5, 
    max: 1.5, 
    step: 0.05 
  },
  reverb: { 
    min: 0, 
    max: 100, 
    step: 1 
  },
  bassBoost: { 
    min: 0, 
    max: 100, 
    step: 1 
  }
};

/**
 * Audio processing constants.
 * Defines frequencies, gains, and timing parameters.
 */
export const AUDIO_CONSTANTS = {
  // Bass boost filter settings (lowshelf filter)
  bassBoost: {
    frequency: 250,      // Hz - cutoff frequency for bass boost
    maxGainDb: 6,        // Maximum gain in dB at 100%
    filterType: 'lowshelf'
  },
  
  // Reverb/Impulse Response settings
  reverb: {
    minDuration: 1.5,    // Minimum IR duration in seconds
    maxDuration: 3.0,    // Maximum IR duration in seconds
    defaultDuration: 2.0, // Default IR duration (2 секунды)
    defaultDecay: 1.0    // Not used, kept for compatibility
  },
  
  // Audio context settings
  context: {
    sampleRate: 44100,   // Default sample rate
    latencyHint: 'interactive'
  },
  

};

/**
 * Message types for communication between extension components.
 */
export const MESSAGE_TYPES = {
  // Popup → Service Worker
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  GET_SETTINGS: 'GET_SETTINGS',
  TOGGLE_EXTENSION: 'TOGGLE_EXTENSION',
  RESET_SETTINGS: 'RESET_SETTINGS',
  
  // Service Worker → Offscreen
  START_CAPTURE: 'START_CAPTURE',
  STOP_CAPTURE: 'STOP_CAPTURE',
  UPDATE_AUDIO: 'UPDATE_AUDIO',
  
  // Offscreen → Service Worker
  STREAM_ENDED: 'STREAM_ENDED'
};

/**
 * Error codes for error handling.
 */
export const ERROR_CODES = {
  AUDIO_CONTEXT_INIT_FAILED: 'AUDIO_CONTEXT_INIT_FAILED',
  TAB_CAPTURE_PERMISSION_DENIED: 'TAB_CAPTURE_PERMISSION_DENIED',
  TAB_CAPTURE_FAILED: 'TAB_CAPTURE_FAILED',
  SETTINGS_SAVE_FAILED: 'SETTINGS_SAVE_FAILED',
  SETTINGS_LOAD_FAILED: 'SETTINGS_LOAD_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

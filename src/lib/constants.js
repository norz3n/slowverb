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
 * @property {boolean} pitchCorrection - Whether to maintain original pitch
 * @property {boolean} enabled - Whether the extension is active
 */
export const DEFAULT_SETTINGS = {
  speed: 1.0,
  reverb: 0,
  bassBoost: 0,
  pitchCorrection: false,
  enabled: false
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
    maxGainDb: 12,       // Maximum gain in dB at 100%
    filterType: 'lowshelf'
  },
  
  // Reverb/Impulse Response settings (Schroeder reverb algorithm)
  reverb: {
    minDuration: 3.0,    // Minimum IR duration in seconds
    maxDuration: 6.0,    // Maximum IR duration in seconds
    defaultDuration: 4.0, // Default IR duration (hall effect)
    defaultDecay: 1.0    // Default decay rate
  },
  
  // Audio context settings
  context: {
    sampleRate: 44100,   // Default sample rate
    latencyHint: 'interactive'
  },
  
  // Pitch correction settings
  pitchCorrection: {
    maxLatencyMs: 100    // Maximum acceptable latency
  }
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
  UPDATE_AUDIO: 'UPDATE_AUDIO'
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

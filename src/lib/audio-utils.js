/**
 * Slowverb Extension - Audio Utility Functions
 * 
 * Provides calculation functions for audio processing parameters.
 * Requirements: 1.1 (speed), 2.1 (reverb), 4.1 (bass boost)
 */

import { CONSTRAINTS, AUDIO_CONSTANTS } from './constants.js';

/**
 * Calculates the playback rate from a speed value.
 * The playback rate directly equals the speed value within valid range.
 * 
 * Property 1: Speed value maps to playback rate
 * Validates: Requirements 1.1
 * 
 * @param {number} speed - Speed value (0.5 to 1.5)
 * @returns {number} Playback rate (clamped to valid range)
 */
export function calculatePlaybackRate(speed) {
  const clampedSpeed = Math.max(
    CONSTRAINTS.speed.min,
    Math.min(CONSTRAINTS.speed.max, speed)
  );
  return clampedSpeed;
}

/**
 * Calculates wet and dry gain values from reverb percentage.
 * Optimized for Slowed & Reverb style - smooth, atmospheric sound.
 * 
 * Property 3: Reverb percentage maps to wet/dry mix
 * Validates: Requirements 2.1
 * 
 * @param {number} reverbPercent - Reverb percentage (0 to 100)
 * @returns {{wetGain: number, dryGain: number}} Wet and dry gain values
 */
export function calculateWetDryMix(reverbPercent) {
  const clampedPercent = Math.max(
    CONSTRAINTS.reverb.min,
    Math.min(CONSTRAINTS.reverb.max, reverbPercent)
  );
  
  // Более агрессивная кривая для ощутимого эффекта
  // При 50% reverb: wet ~0.7, при 100%: wet ~1.4
  const wetGain = (clampedPercent / 100) * 1.4;
  
  // Dry сохраняется высоким для ясности
  const dryGain = 1 - (clampedPercent / 400);
  
  return { wetGain, dryGain };
}

/**
 * Calculates bass boost filter gain in dB from percentage.
 * Maps 0-100% to 0-12 dB linearly.
 * 
 * Property 6: Bass boost percentage maps to filter gain
 * Validates: Requirements 4.1
 * 
 * @param {number} percent - Bass boost percentage (0 to 100)
 * @returns {number} Filter gain in dB (0 to 12)
 */
export function calculateBassBoostGain(percent) {
  const clampedPercent = Math.max(
    CONSTRAINTS.bassBoost.min,
    Math.min(CONSTRAINTS.bassBoost.max, percent)
  );
  
  const gainDb = clampedPercent * (AUDIO_CONSTANTS.bassBoost.maxGainDb / 100);
  return gainDb;
}

/**
 * Formats speed value for display with two decimal precision.
 * Shows values like 0.50x, 0.55x, 1.00x, 1.50x
 * 
 * Property 2: Speed display formatting
 * Validates: Requirements 1.3
 * 
 * @param {number} speed - Speed value (0.5 to 1.5)
 * @returns {string} Formatted string (e.g., "0.50x", "0.85x", "1.50x")
 */
export function formatSpeedDisplay(speed) {
  const clampedSpeed = Math.max(
    CONSTRAINTS.speed.min,
    Math.min(CONSTRAINTS.speed.max, speed)
  );
  
  return `${clampedSpeed.toFixed(2)}x`;
}

/**
 * Generates a vintage-style impulse response for Slowed & Reverb.
 * 
 * Простой подход:
 * - Decaying noise с экспоненциальным затуханием
 * - Коэффициент decay = 3 для естественного звучания
 * 
 * Property 4: Impulse response generation
 * Validates: Requirements 2.4
 * 
 * @param {AudioContext} context - Web Audio API AudioContext
 * @param {number} duration - Duration of the impulse response in seconds
 * @param {number} decay - Decay rate (not used, kept for API compatibility)
 * @returns {AudioBuffer} Stereo AudioBuffer with vintage reverb
 */
export function generateImpulseResponse(context, duration) {
  const sampleRate = context.sampleRate;
  // Длительность IR = 1.5-3 секунды
  const irDuration = Math.max(1.5, Math.min(3.0, duration));
  const length = Math.floor(irDuration * sampleRate);
  
  const buffer = context.createBuffer(2, length, sampleRate);
  const leftChannel = buffer.getChannelData(0);
  const rightChannel = buffer.getChannelData(1);
  
  // Генерируем decaying noise (как в Vintage Reverb HTML)
  // decay = 3 даёт естественное затухание
  for (let i = 0; i < length; i++) {
    const decayEnvelope = Math.exp(-3 * i / length);
    leftChannel[i] = (Math.random() - 0.5) * 2 * decayEnvelope;
    rightChannel[i] = (Math.random() - 0.5) * 2 * decayEnvelope;
  }
  
  return buffer;
}

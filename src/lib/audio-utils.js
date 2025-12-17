/**
 * Slowverb Extension - Audio Utility Functions
 * 
 * Provides calculation functions for audio processing parameters.
 * Requirements: 1.1 (speed), 2.1 (reverb), 4.1 (bass boost), 3.1 (pitch correction)
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
 * Calculates pitch correction factor based on speed and enabled state.
 * When enabled: factor = 1 / speed (compensates for speed-induced pitch change)
 * When disabled: factor = 1.0 (no pitch modification)
 * 
 * Property 5: Pitch correction factor calculation
 * Validates: Requirements 3.1, 3.2
 * 
 * @param {number} speed - Current playback speed (0.5 to 1.5)
 * @param {boolean} pitchCorrectionEnabled - Whether pitch correction is enabled
 * @returns {number} Pitch factor for the pitch shifter
 */
export function calculatePitchFactor(speed, pitchCorrectionEnabled) {
  if (!pitchCorrectionEnabled) {
    return 1.0;
  }
  
  const clampedSpeed = Math.max(
    CONSTRAINTS.speed.min,
    Math.min(CONSTRAINTS.speed.max, speed)
  );
  
  return 1 / clampedSpeed;
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
 * Generates a high-quality stereo impulse response using Freeverb-style algorithm.
 * Creates smooth, lush reverb suitable for Slowed & Reverb music.
 * 
 * Использует:
 * - 8 параллельных Lowpass-Feedback Comb Filters (LBCF) для плотности
 * - 4 последовательных Allpass filters для диффузии
 * - Разные задержки для L/R каналов для стерео ширины
 * - Lowpass в feedback loop для устранения металлического звука
 * 
 * Property 4: Impulse response generation
 * Validates: Requirements 2.4
 * 
 * @param {AudioContext} context - Web Audio API AudioContext
 * @param {number} duration - Duration of the impulse response in seconds
 * @param {number} decay - Decay rate (higher = faster decay)
 * @returns {AudioBuffer} Stereo AudioBuffer with hall-style reverb
 */
export function generateImpulseResponse(context, duration, decay) {
  const reverbDuration = Math.max(3.0, Math.min(6.0, duration));
  const clampedDecay = Math.max(0.3, Math.min(2.0, decay));
  
  const sampleRate = context.sampleRate;
  const length = Math.floor(reverbDuration * sampleRate);
  
  const buffer = context.createBuffer(2, length, sampleRate);
  const leftChannel = buffer.getChannelData(0);
  const rightChannel = buffer.getChannelData(1);
  
  // Freeverb-style comb filter delays (в samples при 44100Hz)
  // Разные для L/R для стерео spread
  const combDelaysL = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map(
    d => Math.floor(d * sampleRate / 44100)
  );
  const combDelaysR = [1617, 1557, 1422, 1491, 1356, 1277, 1116, 1188].map(
    d => Math.floor(d * sampleRate / 44100)
  );
  
  // Allpass delays (одинаковые для обоих каналов)
  const allpassDelays = [556, 441, 341, 225].map(
    d => Math.floor(d * sampleRate / 44100)
  );
  
  // RT60 время реверберации
  const rt60 = reverbDuration * 0.9;
  
  // Feedback для comb filters (определяет длину хвоста)
  const roomSize = 0.85; // 0-1, больше = длиннее reverb
  const baseFeedback = Math.pow(0.001, 1 / (rt60 * sampleRate / 1000));
  
  // Damping для lowpass в feedback (убирает металлический звук)
  const damping = 0.4; // 0-1, больше = темнее звук
  
  // Буферы для comb filters
  const combBuffersL = combDelaysL.map(d => new Float32Array(d));
  const combBuffersR = combDelaysR.map(d => new Float32Array(d));
  const combIndicesL = combDelaysL.map(() => 0);
  const combIndicesR = combDelaysR.map(() => 0);
  
  // Lowpass state для каждого comb filter
  const filterStoreL = new Float32Array(combDelaysL.length);
  const filterStoreR = new Float32Array(combDelaysR.length);
  
  // Буферы для allpass filters
  const allpassBuffersL = allpassDelays.map(d => new Float32Array(d));
  const allpassBuffersR = allpassDelays.map(d => new Float32Array(d));
  const allpassIndicesL = allpassDelays.map(() => 0);
  const allpassIndicesR = allpassDelays.map(() => 0);
  
  // Allpass coefficient
  const allpassFeedback = 0.5;
  
  // Генерируем импульс с early reflections
  const impulseL = new Float32Array(length);
  const impulseR = new Float32Array(length);
  
  // Начальный импульс
  impulseL[0] = 1.0;
  impulseR[0] = 1.0;
  
  // Early reflections для пространственности
  const earlyReflections = [
    { timeMs: 8, gainL: 0.9, gainR: 0.85 },
    { timeMs: 15, gainL: 0.8, gainR: 0.82 },
    { timeMs: 22, gainL: 0.7, gainR: 0.72 },
    { timeMs: 32, gainL: 0.6, gainR: 0.58 },
    { timeMs: 45, gainL: 0.5, gainR: 0.52 },
    { timeMs: 58, gainL: 0.4, gainR: 0.38 },
    { timeMs: 75, gainL: 0.3, gainR: 0.32 },
    { timeMs: 95, gainL: 0.2, gainR: 0.22 },
  ];
  
  for (const er of earlyReflections) {
    const sampleIdxL = Math.floor(er.timeMs * sampleRate / 1000);
    const sampleIdxR = Math.floor((er.timeMs + 3) * sampleRate / 1000); // Stereo offset
    if (sampleIdxL < length) impulseL[sampleIdxL] += er.gainL;
    if (sampleIdxR < length) impulseR[sampleIdxR] += er.gainR;
  }
  
  // Процессинг через Lowpass-Feedback Comb Filters (параллельно)
  const combOutputL = new Float32Array(length);
  const combOutputR = new Float32Array(length);
  
  for (let i = 0; i < length; i++) {
    let sumL = 0;
    let sumR = 0;
    
    // Обрабатываем все comb filters параллельно
    for (let c = 0; c < combDelaysL.length; c++) {
      // Left channel LBCF
      const delayL = combBuffersL[c];
      const delayLenL = combDelaysL[c];
      const idxL = combIndicesL[c];
      
      const outputL = delayL[idxL];
      sumL += outputL;
      
      // Lowpass filter в feedback loop (убирает металлический звук)
      filterStoreL[c] = outputL * (1 - damping) + filterStoreL[c] * damping;
      delayL[idxL] = impulseL[i] + filterStoreL[c] * roomSize;
      combIndicesL[c] = (idxL + 1) % delayLenL;
      
      // Right channel LBCF
      const delayR = combBuffersR[c];
      const delayLenR = combDelaysR[c];
      const idxR = combIndicesR[c];
      
      const outputR = delayR[idxR];
      sumR += outputR;
      
      filterStoreR[c] = outputR * (1 - damping) + filterStoreR[c] * damping;
      delayR[idxR] = impulseR[i] + filterStoreR[c] * roomSize;
      combIndicesR[c] = (idxR + 1) % delayLenR;
    }
    
    // Нормализуем сумму comb filters
    combOutputL[i] = sumL / combDelaysL.length;
    combOutputR[i] = sumR / combDelaysR.length;
  }
  
  // Процессинг через Allpass filters (последовательно) для диффузии
  let currentL = combOutputL;
  let currentR = combOutputR;
  
  for (let a = 0; a < allpassDelays.length; a++) {
    const delayL = allpassBuffersL[a];
    const delayR = allpassBuffersR[a];
    const delayLen = allpassDelays[a];
    
    const outputL = new Float32Array(length);
    const outputR = new Float32Array(length);
    
    let idxL = allpassIndicesL[a];
    let idxR = allpassIndicesR[a];
    
    for (let i = 0; i < length; i++) {
      // Left allpass
      const bufferedL = delayL[idxL];
      const inputL = currentL[i];
      outputL[i] = -inputL * allpassFeedback + bufferedL;
      delayL[idxL] = inputL + bufferedL * allpassFeedback;
      idxL = (idxL + 1) % delayLen;
      
      // Right allpass
      const bufferedR = delayR[idxR];
      const inputR = currentR[i];
      outputR[i] = -inputR * allpassFeedback + bufferedR;
      delayR[idxR] = inputR + bufferedR * allpassFeedback;
      idxR = (idxR + 1) % delayLen;
    }
    
    currentL = outputL;
    currentR = outputR;
  }
  
  // Копируем результат в выходной буфер
  for (let i = 0; i < length; i++) {
    leftChannel[i] = currentL[i];
    rightChannel[i] = currentR[i];
  }
  
  // Применяем мягкий decay envelope
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Более медленный decay для длинного хвоста
    const envelope = Math.exp(-clampedDecay * 0.7 * t);
    leftChannel[i] *= envelope;
    rightChannel[i] *= envelope;
  }
  
  // Финальный lowpass для теплоты
  let prevL = 0, prevR = 0;
  const lpCoeff = 0.2;
  for (let i = 0; i < length; i++) {
    leftChannel[i] = prevL = prevL + lpCoeff * (leftChannel[i] - prevL);
    rightChannel[i] = prevR = prevR + lpCoeff * (rightChannel[i] - prevR);
  }
  
  // Нормализация
  let maxVal = 0;
  for (let i = 0; i < length; i++) {
    maxVal = Math.max(maxVal, Math.abs(leftChannel[i]), Math.abs(rightChannel[i]));
  }
  if (maxVal > 0) {
    const normalizeGain = 0.9 / maxVal;
    for (let i = 0; i < length; i++) {
      leftChannel[i] *= normalizeGain;
      rightChannel[i] *= normalizeGain;
    }
  }
  
  return buffer;
}

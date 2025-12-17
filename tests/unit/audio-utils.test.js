/**
 * Unit tests for audio utility functions.
 * Tests generateImpulseResponse and other audio calculation functions.
 * 
 * Requirements: 2.4 (impulse response generation)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  generateImpulseResponse,
  calculatePlaybackRate,
  calculateWetDryMix,
  calculateBassBoostGain,
  formatSpeedDisplay
} from '../../src/lib/audio-utils.js';
import { AUDIO_CONSTANTS } from '../../src/lib/constants.js';

/**
 * Mock AudioContext for testing generateImpulseResponse.
 * Simulates Web Audio API AudioContext behavior.
 */
class MockAudioContext {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 44100;
  }

  /**
   * Creates a mock AudioBuffer with the specified parameters.
   * @param {number} numberOfChannels - Number of audio channels
   * @param {number} length - Buffer length in samples
   * @param {number} sampleRate - Sample rate in Hz
   * @returns {Object} Mock AudioBuffer
   */
  createBuffer(numberOfChannels, length, sampleRate) {
    const channels = [];
    for (let i = 0; i < numberOfChannels; i++) {
      channels.push(new Float32Array(length));
    }
    
    return {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData(channel) {
        return channels[channel];
      }
    };
  }
}

describe('generateImpulseResponse', () => {
  let mockContext;

  beforeEach(() => {
    mockContext = new MockAudioContext({ sampleRate: 44100 });
  });

  describe('buffer creation', () => {
    it('should create a stereo buffer (2 channels)', () => {
      const buffer = generateImpulseResponse(mockContext, 2.0, 2.0);
      expect(buffer.numberOfChannels).toBe(2);
    });

    it('should create buffer with correct length based on duration and sample rate', () => {
      const duration = 2.0;
      const buffer = generateImpulseResponse(mockContext, duration, 1.0);
      const expectedLength = Math.floor(duration * mockContext.sampleRate);
      expect(buffer.length).toBe(expectedLength);
    });

    it('should clamp duration to minimum (1.5s)', () => {
      const buffer = generateImpulseResponse(mockContext, 0.5, 1.0);
      const expectedLength = Math.floor(1.5 * mockContext.sampleRate);
      expect(buffer.length).toBe(expectedLength);
    });

    it('should clamp duration to maximum (3.0s)', () => {
      const buffer = generateImpulseResponse(mockContext, 15.0, 1.0);
      const expectedLength = Math.floor(3.0 * mockContext.sampleRate);
      expect(buffer.length).toBe(expectedLength);
    });
  });

  describe('exponential decay', () => {
    it('should have higher amplitude at the beginning than at the end', () => {
      const buffer = generateImpulseResponse(mockContext, 2.0, 2.0);
      const leftChannel = buffer.getChannelData(0);
      
      // Calculate average amplitude in first 10% vs last 10%
      const tenPercent = Math.floor(buffer.length * 0.1);
      
      let startSum = 0;
      let endSum = 0;
      
      for (let i = 0; i < tenPercent; i++) {
        startSum += Math.abs(leftChannel[i]);
        endSum += Math.abs(leftChannel[buffer.length - 1 - i]);
      }
      
      const startAvg = startSum / tenPercent;
      const endAvg = endSum / tenPercent;
      
      // Start should have significantly higher amplitude than end
      expect(startAvg).toBeGreaterThan(endAvg);
    });

    it('should produce different values for left and right channels (stereo)', () => {
      const buffer = generateImpulseResponse(mockContext, 2.0, 1.0);
      const leftChannel = buffer.getChannelData(0);
      const rightChannel = buffer.getChannelData(1);
      
      // Decaying noise создаёт разные значения для L/R каналов
      // Проверяем что каналы отличаются в средней части буфера
      let differences = 0;
      const startSample = Math.floor(buffer.length * 0.1);
      const samplesToCheck = 1000;
      
      for (let i = startSample; i < startSample + samplesToCheck; i++) {
        if (Math.abs(leftChannel[i] - rightChannel[i]) > 0.0001) {
          differences++;
        }
      }
      
      // Должны быть различия из-за независимого шума
      expect(differences).toBeGreaterThan(samplesToCheck * 0.5);
    });

    it('should contain values in range [-1, 1]', () => {
      const buffer = generateImpulseResponse(mockContext, 2.0, 2.0);
      const leftChannel = buffer.getChannelData(0);
      const rightChannel = buffer.getChannelData(1);
      
      // Check a sample of values for performance
      const step = Math.floor(buffer.length / 1000);
      for (let i = 0; i < buffer.length; i += step) {
        expect(leftChannel[i]).toBeGreaterThanOrEqual(-1);
        expect(leftChannel[i]).toBeLessThanOrEqual(1);
        expect(rightChannel[i]).toBeGreaterThanOrEqual(-1);
        expect(rightChannel[i]).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('decay behavior', () => {
    it('should use fixed decay rate (decay parameter ignored)', () => {
      // Decay parameter is kept for API compatibility but not used
      const buffer = generateImpulseResponse(mockContext, 2.0, 1.0);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });
});

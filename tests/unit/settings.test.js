/**
 * Unit tests for settings storage functions.
 * Tests validateSettings function for correct clamping and validation.
 * 
 * Requirements: 7.1, 7.2, 7.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateSettings } from '../../src/lib/settings.js';
import { DEFAULT_SETTINGS, CONSTRAINTS } from '../../src/lib/constants.js';

describe('validateSettings', () => {
  describe('speed validation', () => {
    it('should clamp speed below minimum to 0.5', () => {
      const result = validateSettings({ speed: 0.1 });
      expect(result.speed).toBe(CONSTRAINTS.speed.min);
    });

    it('should clamp speed above maximum to 1.5', () => {
      const result = validateSettings({ speed: 2.0 });
      expect(result.speed).toBe(CONSTRAINTS.speed.max);
    });

    it('should keep valid speed unchanged', () => {
      const result = validateSettings({ speed: 1.0 });
      expect(result.speed).toBe(1.0);
    });

    it('should handle NaN speed by not including it', () => {
      const result = validateSettings({ speed: NaN });
      expect(result.speed).toBeUndefined();
    });
  });

  describe('reverb validation', () => {
    it('should clamp reverb below minimum to 0', () => {
      const result = validateSettings({ reverb: -10 });
      expect(result.reverb).toBe(CONSTRAINTS.reverb.min);
    });

    it('should clamp reverb above maximum to 100', () => {
      const result = validateSettings({ reverb: 150 });
      expect(result.reverb).toBe(CONSTRAINTS.reverb.max);
    });

    it('should keep valid reverb unchanged', () => {
      const result = validateSettings({ reverb: 50 });
      expect(result.reverb).toBe(50);
    });
  });

  describe('bassBoost validation', () => {
    it('should clamp bassBoost below minimum to 0', () => {
      const result = validateSettings({ bassBoost: -5 });
      expect(result.bassBoost).toBe(CONSTRAINTS.bassBoost.min);
    });

    it('should clamp bassBoost above maximum to 100', () => {
      const result = validateSettings({ bassBoost: 200 });
      expect(result.bassBoost).toBe(CONSTRAINTS.bassBoost.max);
    });

    it('should keep valid bassBoost unchanged', () => {
      const result = validateSettings({ bassBoost: 75 });
      expect(result.bassBoost).toBe(75);
    });
  });

  describe('boolean validation', () => {
    it('should coerce enabled to boolean', () => {
      expect(validateSettings({ enabled: 1 }).enabled).toBe(true);
      expect(validateSettings({ enabled: 0 }).enabled).toBe(false);
    });
  });

  describe('partial settings', () => {
    it('should only validate provided fields', () => {
      const result = validateSettings({ speed: 0.8 });
      expect(result).toEqual({ speed: 0.8 });
    });

    it('should handle empty object', () => {
      const result = validateSettings({});
      expect(result).toEqual({});
    });
  });
});

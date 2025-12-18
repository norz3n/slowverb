/**
 * Slowverb Extension - Shared Audio Processor
 * 
 * Platform-agnostic Web Audio API processing.
 * Used by both Chrome (offscreen) and Firefox (background).
 * 
 * Requirements: 6.1 (audio processing pipeline), 6.4 (resource cleanup)
 */

import { 
  calculatePlaybackRate, 
  calculateWetDryMix, 
  calculateBassBoostGain,
  generateImpulseResponse 
} from './audio-utils.js';
import { 
  ERROR_CODES, 
  AUDIO_CONSTANTS,
  DEFAULT_SETTINGS 
} from './constants.js';

/**
 * Creates a new audio processor instance.
 * Factory function to allow multiple instances if needed.
 * 
 * @param {Function} onStreamEnded - Callback when stream ends
 * @returns {Object} Audio processor instance
 */
export function createAudioProcessor(onStreamEnded) {
  const state = {
    context: null,
    source: null,
    mediaStream: null,
    bassBoostFilter: null,
    reverbHighpass: null,
    convolver: null,
    dryGain: null,
    wetGain: null,
    outputGain: null,
    currentSettings: { ...DEFAULT_SETTINGS }
  };

  /**
   * Initializes AudioContext with proper error handling.
   * @returns {Promise<AudioContext>}
   */
  async function initContext() {
    if (state.context && state.context.state !== 'closed') {
      if (state.context.state === 'suspended') {
        await state.context.resume();
      }
      return state.context;
    }
    
    state.context = new AudioContext({
      latencyHint: AUDIO_CONSTANTS.context.latencyHint,
      sampleRate: AUDIO_CONSTANTS.context.sampleRate
    });
    
    if (state.context.state === 'suspended') {
      await state.context.resume();
    }
    
    console.log('[Slowverb] AudioContext initialized');
    return state.context;
  }

  /**
   * Sets up the audio processing graph.
   */
  function setupGraph() {
    const ctx = state.context;
    if (!ctx) return;
    
    // Cleanup existing nodes
    if (state.outputGain) {
      [state.bassBoostFilter, state.reverbHighpass, state.convolver, 
       state.dryGain, state.wetGain, state.outputGain].forEach(node => {
        try { node?.disconnect(); } catch (e) { /* ignore */ }
      });
    }
    
    // Bass boost filter (lowshelf)
    state.bassBoostFilter = ctx.createBiquadFilter();
    state.bassBoostFilter.type = AUDIO_CONSTANTS.bassBoost.filterType;
    state.bassBoostFilter.frequency.value = AUDIO_CONSTANTS.bassBoost.frequency;
    state.bassBoostFilter.gain.value = 0;
    state.bassBoostFilter.channelCount = 2;
    state.bassBoostFilter.channelCountMode = 'explicit';
    
    // Highpass for reverb path
    state.reverbHighpass = ctx.createBiquadFilter();
    state.reverbHighpass.type = 'highpass';
    state.reverbHighpass.frequency.value = 200;
    state.reverbHighpass.Q.value = 0.7;
    state.reverbHighpass.channelCount = 2;
    state.reverbHighpass.channelCountMode = 'explicit';
    
    // Convolver for reverb
    state.convolver = ctx.createConvolver();
    state.convolver.channelCount = 2;
    state.convolver.channelCountMode = 'explicit';
    state.convolver.buffer = generateImpulseResponse(
      ctx,
      AUDIO_CONSTANTS.reverb.defaultDuration,
      AUDIO_CONSTANTS.reverb.defaultDecay
    );
    
    // Dry/wet gains
    state.dryGain = ctx.createGain();
    state.dryGain.gain.value = 1.0;
    state.dryGain.channelCount = 2;
    state.dryGain.channelCountMode = 'explicit';
    
    state.wetGain = ctx.createGain();
    state.wetGain.gain.value = 0;
    state.wetGain.channelCount = 2;
    state.wetGain.channelCountMode = 'explicit';
    
    // Output gain
    state.outputGain = ctx.createGain();
    state.outputGain.gain.value = 1.0;
    state.outputGain.channelCount = 2;
    state.outputGain.channelCountMode = 'explicit';
    
    // Connect graph: bassBoost → dry/wet split → output
    state.bassBoostFilter.connect(state.dryGain);
    state.bassBoostFilter.connect(state.reverbHighpass);
    state.reverbHighpass.connect(state.convolver);
    state.convolver.connect(state.wetGain);
    state.dryGain.connect(state.outputGain);
    state.wetGain.connect(state.outputGain);
    state.outputGain.connect(ctx.destination);
    
    console.log('[Slowverb] Audio graph setup complete');
  }

  /**
   * Connects a MediaStream to the audio graph.
   * @param {MediaStream} stream - Audio stream to process
   */
  function connectStream(stream) {
    // Cleanup previous
    if (state.source) {
      try { state.source.disconnect(); } catch (e) { /* ignore */ }
    }
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach(t => t.stop());
    }
    
    state.mediaStream = stream;
    
    // Monitor stream end
    stream.getTracks().forEach(track => {
      track.addEventListener('ended', () => {
        console.log('[Slowverb] Track ended:', track.kind);
        onStreamEnded?.();
      });
    });
    stream.addEventListener('inactive', () => {
      console.log('[Slowverb] Stream inactive');
      onStreamEnded?.();
    });
    
    // Create source and connect
    state.source = state.context.createMediaStreamSource(stream);
    state.source.connect(state.bassBoostFilter);
    
    console.log('[Slowverb] Stream connected');
  }

  /**
   * Updates speed setting.
   * @param {number} value - Speed (0.5-1.5)
   */
  function updateSpeed(value) {
    state.currentSettings.speed = calculatePlaybackRate(value);
  }

  /**
   * Updates reverb mix.
   * @param {number} value - Reverb percentage (0-100)
   */
  function updateReverb(value) {
    const { wetGain, dryGain } = calculateWetDryMix(value);
    state.currentSettings.reverb = value;
    if (state.wetGain && state.dryGain) {
      state.wetGain.gain.value = wetGain;
      state.dryGain.gain.value = dryGain;
    }
  }

  /**
   * Updates bass boost.
   * @param {number} value - Bass boost percentage (0-100)
   */
  function updateBassBoost(value) {
    const gainDb = calculateBassBoostGain(value);
    state.currentSettings.bassBoost = value;
    if (state.bassBoostFilter) {
      state.bassBoostFilter.gain.value = gainDb;
    }
  }

  /**
   * Applies all settings.
   * @param {Object} settings - Settings object
   */
  function applySettings(settings) {
    updateSpeed(settings.speed ?? state.currentSettings.speed);
    updateReverb(settings.reverb ?? state.currentSettings.reverb);
    updateBassBoost(settings.bassBoost ?? state.currentSettings.bassBoost);
  }

  /**
   * Disconnects and releases all resources.
   */
  function disconnect() {
    console.log('[Slowverb] Disconnecting audio processor...');
    
    if (state.source) {
      try { state.source.disconnect(); } catch (e) { /* ignore */ }
      state.source = null;
    }
    
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach(t => t.stop());
      state.mediaStream = null;
    }
    
    [state.bassBoostFilter, state.reverbHighpass, state.convolver,
     state.dryGain, state.wetGain, state.outputGain].forEach(node => {
      try { node?.disconnect(); } catch (e) { /* ignore */ }
    });
    
    state.bassBoostFilter = null;
    state.reverbHighpass = null;
    state.convolver = null;
    state.dryGain = null;
    state.wetGain = null;
    state.outputGain = null;
    
    if (state.context) {
      try { state.context.close(); } catch (e) { /* ignore */ }
      state.context = null;
    }
    
    state.currentSettings = { ...DEFAULT_SETTINGS };
    console.log('[Slowverb] Audio processor disconnected');
  }

  /**
   * Gets current state (for debugging).
   * @returns {Object}
   */
  function getState() {
    return { ...state };
  }

  return {
    initContext,
    setupGraph,
    connectStream,
    updateSpeed,
    updateReverb,
    updateBassBoost,
    applySettings,
    disconnect,
    getState
  };
}

export { ERROR_CODES };

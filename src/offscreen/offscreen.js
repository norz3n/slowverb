/**
 * Slowverb Extension - Offscreen Document Audio Processor
 * 
 * Handles all Web Audio API operations for the extension.
 * This offscreen document is required because service workers don't have access to Web Audio API.
 * 
 * Requirements: 6.1 (audio processing pipeline), 6.2 (tabCapture with offscreen), 6.4 (resource cleanup)
 */

import { 
  calculatePlaybackRate, 
  calculateWetDryMix, 
  calculateBassBoostGain,
  generateImpulseResponse 
} from '../lib/audio-utils.js';
import { 
  MESSAGE_TYPES, 
  ERROR_CODES, 
  AUDIO_CONSTANTS,
  DEFAULT_SETTINGS 
} from '../lib/constants.js';
import { StreamPitchShifter } from '../lib/soundtouch.js';

/**
 * Audio processor state object.
 * Contains AudioContext and all audio nodes.
 * 
 * @type {Object}
 */
const audioProcessor = {
  context: null,
  source: null,
  mediaStream: null, // MediaStream from tab capture - needs to be stopped on disconnect
  pitchShifter: null, // StreamPitchShifter for pitch-preserved tempo change
  bassBoostFilter: null,
  reverbHighpass: null, // Highpass filter to remove low frequencies from reverb
  convolver: null,
  dryGain: null,
  wetGain: null,
  outputGain: null,
  // Current settings for reference
  currentSettings: { ...DEFAULT_SETTINGS },
  // Stream monitoring
  streamEndedHandler: null
};

/**
 * Notifies service worker that the stream has ended.
 * This happens when YouTube or other SPA sites recreate their media elements.
 */
function notifyStreamEnded() {
  console.log('[Slowverb] Stream ended, notifying service worker');
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.STREAM_ENDED
  }).catch(e => {
    console.warn('[Slowverb] Failed to notify stream ended:', e);
  });
}


/**
 * Initializes the AudioContext with proper error handling.
 * Handles suspended state by resuming the context.
 * 
 * Requirements: 6.2
 * 
 * @returns {Promise<AudioContext>} Initialized AudioContext
 * @throws {Error} If AudioContext creation fails
 */
async function initAudioContext() {
  try {
    // Если контекст уже существует и активен, используем его
    if (audioProcessor.context && audioProcessor.context.state !== 'closed') {
      if (audioProcessor.context.state === 'suspended') {
        await audioProcessor.context.resume();
      }
      console.log('[Slowverb] Reusing existing AudioContext, state:', audioProcessor.context.state);
      return audioProcessor.context;
    }
    
    // Create AudioContext with interactive latency hint for real-time processing
    audioProcessor.context = new AudioContext({
      latencyHint: AUDIO_CONSTANTS.context.latencyHint,
      sampleRate: AUDIO_CONSTANTS.context.sampleRate
    });
    
    // Handle suspended state (browsers may suspend AudioContext until user interaction)
    if (audioProcessor.context.state === 'suspended') {
      await audioProcessor.context.resume();
    }
    
    console.log('[Slowverb] AudioContext initialized, state:', audioProcessor.context.state);
    
    return audioProcessor.context;
  } catch (error) {
    console.error('[Slowverb] Failed to create AudioContext:', error);
    throw new Error(ERROR_CODES.AUDIO_CONTEXT_INIT_FAILED);
  }
}

/**
 * Sets up the audio processing graph with all required nodes.
 * Creates and connects nodes in the correct order:
 * source → bassBoost → dry/wet split → output
 * 
 * Requirements: 6.1 (effects order: bass boost, reverb)
 * 
 * @returns {void}
 */
function setupAudioGraph() {
  const ctx = audioProcessor.context;
  if (!ctx) {
    console.error('[Slowverb] AudioContext not initialized');
    return;
  }
  
  // Если граф уже создан, пересоздаём его для чистого состояния
  if (audioProcessor.outputGain) {
    console.log('[Slowverb] Recreating audio graph for fresh state');
    // Отключаем старые ноды
    try {
      if (audioProcessor.bassBoostFilter) audioProcessor.bassBoostFilter.disconnect();
      if (audioProcessor.reverbHighpass) audioProcessor.reverbHighpass.disconnect();
      if (audioProcessor.convolver) audioProcessor.convolver.disconnect();
      if (audioProcessor.dryGain) audioProcessor.dryGain.disconnect();
      if (audioProcessor.wetGain) audioProcessor.wetGain.disconnect();
      if (audioProcessor.outputGain) audioProcessor.outputGain.disconnect();
    } catch (e) {
      // Ignore disconnect errors
    }
  }
  
  // Create bass boost filter (lowshelf) - stereo
  audioProcessor.bassBoostFilter = ctx.createBiquadFilter();
  audioProcessor.bassBoostFilter.type = AUDIO_CONSTANTS.bassBoost.filterType;
  audioProcessor.bassBoostFilter.frequency.value = AUDIO_CONSTANTS.bassBoost.frequency;
  audioProcessor.bassBoostFilter.gain.value = 0; // Start with no boost
  audioProcessor.bassBoostFilter.channelCount = 2;
  audioProcessor.bassBoostFilter.channelCountMode = 'explicit';
  
  // Create highpass filter for reverb path - removes low frequency rumble
  audioProcessor.reverbHighpass = ctx.createBiquadFilter();
  audioProcessor.reverbHighpass.type = 'highpass';
  audioProcessor.reverbHighpass.frequency.value = 200; // Cut frequencies below 200Hz
  audioProcessor.reverbHighpass.Q.value = 0.7; // Gentle slope
  audioProcessor.reverbHighpass.channelCount = 2;
  audioProcessor.reverbHighpass.channelCountMode = 'explicit';
  
  // Create convolver for reverb effect - stereo
  audioProcessor.convolver = ctx.createConvolver();
  audioProcessor.convolver.channelCount = 2;
  audioProcessor.convolver.channelCountMode = 'explicit';
  // Generate default impulse response (stereo)
  const irBuffer = generateImpulseResponse(
    ctx,
    AUDIO_CONSTANTS.reverb.defaultDuration,
    AUDIO_CONSTANTS.reverb.defaultDecay
  );
  audioProcessor.convolver.buffer = irBuffer;
  
  // Create dry/wet gain nodes for reverb mix - stereo
  audioProcessor.dryGain = ctx.createGain();
  audioProcessor.dryGain.gain.value = 1.0; // Full dry signal by default
  audioProcessor.dryGain.channelCount = 2;
  audioProcessor.dryGain.channelCountMode = 'explicit';
  
  audioProcessor.wetGain = ctx.createGain();
  audioProcessor.wetGain.gain.value = 0; // No wet signal by default
  audioProcessor.wetGain.channelCount = 2;
  audioProcessor.wetGain.channelCountMode = 'explicit';
  
  // Create output gain node - stereo
  audioProcessor.outputGain = ctx.createGain();
  audioProcessor.outputGain.gain.value = 1.0;
  audioProcessor.outputGain.channelCount = 2;
  audioProcessor.outputGain.channelCountMode = 'explicit';
  
  // Create StreamPitchShifter for pitch-preserved tempo change
  // Using larger buffer (8192) to reduce audio crackling
  audioProcessor.pitchShifter = new StreamPitchShifter(ctx, 8192);
  audioProcessor.pitchShifter.tempo = 1.0;
  audioProcessor.pitchShifter.pitch = 1.0;
  
  // Audio graph connections depend on preservePitch setting
  // Default: source → bassBoost → dry/wet → output
  // With preservePitch: source → pitchShifter → bassBoost → dry/wet → output
  audioProcessor.bassBoostFilter.connect(audioProcessor.dryGain);
  audioProcessor.bassBoostFilter.connect(audioProcessor.reverbHighpass);
  audioProcessor.reverbHighpass.connect(audioProcessor.convolver);
  audioProcessor.convolver.connect(audioProcessor.wetGain);
  audioProcessor.dryGain.connect(audioProcessor.outputGain);
  audioProcessor.wetGain.connect(audioProcessor.outputGain);
  audioProcessor.outputGain.connect(ctx.destination);
  
  console.log('[Slowverb] Audio graph setup complete');
}


/**
 * Connects tab audio capture to the audio processing graph.
 * Creates MediaStreamSource from the captured tab audio stream.
 * 
 * Requirements: 6.2 (tabCapture API with offscreen document)
 * 
 * @param {string} streamId - Chrome tab capture stream ID
 * @returns {Promise<void>}
 * @throws {Error} If capture connection fails
 */
async function connectTabAudio(streamId) {
  try {
    // Get media stream from tab capture
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });
    
    // Ensure AudioContext is initialized
    if (!audioProcessor.context) {
      await initAudioContext();
      setupAudioGraph();
    }
    
    // Resume context if suspended
    if (audioProcessor.context.state === 'suspended') {
      await audioProcessor.context.resume();
    }
    
    // Disconnect existing source and stop previous stream if any
    if (audioProcessor.source) {
      audioProcessor.source.disconnect();
      audioProcessor.source = null;
    }
    if (audioProcessor.mediaStream) {
      audioProcessor.mediaStream.getTracks().forEach(track => track.stop());
      audioProcessor.mediaStream = null;
    }
    
    // Save stream reference for cleanup
    audioProcessor.mediaStream = stream;
    
    // Monitor stream tracks for ended event (happens when YouTube recreates video element)
    stream.getTracks().forEach(track => {
      track.addEventListener('ended', () => {
        console.log('[Slowverb] Track ended:', track.kind);
        notifyStreamEnded();
      });
    });
    
    // Also monitor stream inactive event
    stream.addEventListener('inactive', () => {
      console.log('[Slowverb] Stream became inactive');
      notifyStreamEnded();
    });
    
    // Create MediaStreamSource from captured audio
    audioProcessor.source = audioProcessor.context.createMediaStreamSource(stream);
    
    // Connect source to the audio graph
    // Connection depends on preservePitch setting - will be reconnected in updatePreservePitch
    connectSourceToGraph();
    
    console.log('[Slowverb] Tab audio connected successfully');
  } catch (error) {
    console.error('[Slowverb] Failed to connect tab audio:', error);
    
    if (error.name === 'NotAllowedError') {
      throw new Error(ERROR_CODES.TAB_CAPTURE_PERMISSION_DENIED);
    }
    throw new Error(ERROR_CODES.TAB_CAPTURE_FAILED);
  }
}

/**
 * Connects source to the audio graph based on preservePitch setting.
 * When preservePitch is enabled: source → pitchShifter → bassBoost → ...
 * When disabled: source → bassBoost → ...
 */
function connectSourceToGraph() {
  if (!audioProcessor.source) return;
  
  // Disconnect source from any previous connections
  try {
    audioProcessor.source.disconnect();
  } catch (e) { /* ignore */ }
  
  // Disconnect pitchShifter output (but don't destroy the node - reuse it)
  if (audioProcessor.pitchShifter && audioProcessor.pitchShifter.outputNode) {
    try {
      audioProcessor.pitchShifter.outputNode.disconnect();
    } catch (e) { /* ignore */ }
    // Clear internal buffers to avoid audio artifacts when switching modes
    audioProcessor.pitchShifter.clear();
  }
  
  if (audioProcessor.currentSettings.preservePitch && audioProcessor.pitchShifter) {
    // source → pitchShifter → bassBoost
    audioProcessor.source.connect(audioProcessor.pitchShifter.inputNode);
    audioProcessor.pitchShifter.outputNode.connect(audioProcessor.bassBoostFilter);
    
    // Video playback rate changes pitch. To compensate:
    // If speed = 0.8, pitch drops to 0.8x. To restore, set pitch = 1/0.8 = 1.25
    // SoundTouch pitch correction: pitch = 1/speed
    const pitchCorrection = 1.0 / audioProcessor.currentSettings.speed;
    audioProcessor.pitchShifter.tempo = 1.0; // Don't change tempo, audio is already slowed by video
    audioProcessor.pitchShifter.pitch = pitchCorrection;
    
    console.log('[Slowverb] Connected with pitch preservation, speed:', audioProcessor.currentSettings.speed, 'pitch correction:', pitchCorrection);
  } else {
    // source → bassBoost (classic mode)
    audioProcessor.source.connect(audioProcessor.bassBoostFilter);
    console.log('[Slowverb] Connected in classic mode (no pitch preservation)');
  }
}

/**
 * Updates the playback speed (playback rate).
 * When preservePitch is enabled, updates pitchShifter pitch correction.
 * 
 * Note: Actual playback rate change for media elements is handled by
 * the content script or media element directly.
 * 
 * Requirements: 1.1
 * 
 * @param {number} value - Speed value (0.5 to 1.5)
 */
function updateSpeed(value) {
  const playbackRate = calculatePlaybackRate(value);
  const previousSpeed = audioProcessor.currentSettings.speed;
  audioProcessor.currentSettings.speed = playbackRate;
  
  // Update pitchShifter pitch correction if preservePitch is enabled
  if (audioProcessor.currentSettings.preservePitch && audioProcessor.pitchShifter) {
    // Clear buffers when speed changes to avoid mixing old pitch-corrected data
    // This prevents pitch artifacts when switching between presets (e.g., Nightcore → Slowed)
    if (previousSpeed !== playbackRate) {
      audioProcessor.pitchShifter.clear();
    }
    
    // Video playback changes pitch proportionally to speed
    // To compensate: pitch = 1/speed (e.g., speed 0.8 → pitch 1.25)
    const pitchCorrection = 1.0 / playbackRate;
    audioProcessor.pitchShifter.tempo = 1.0;
    audioProcessor.pitchShifter.pitch = pitchCorrection;
  }
  
  console.log('[Slowverb] Speed updated to:', playbackRate);
}

/**
 * Updates preserve pitch setting.
 * Reconnects audio graph when setting changes.
 * 
 * @param {boolean} enabled - Whether to preserve pitch
 */
function updatePreservePitch(enabled) {
  const wasEnabled = audioProcessor.currentSettings.preservePitch;
  audioProcessor.currentSettings.preservePitch = enabled;
  
  // Reconnect graph if setting changed and source exists
  if (wasEnabled !== enabled && audioProcessor.source) {
    connectSourceToGraph();
  }
  
  console.log('[Slowverb] Preserve pitch:', enabled);
}

/**
 * Updates the reverb wet/dry mix.
 * 
 * Requirements: 2.1
 * 
 * @param {number} value - Reverb percentage (0 to 100)
 */
function updateReverb(value) {
  const { wetGain, dryGain } = calculateWetDryMix(value);
  
  audioProcessor.currentSettings.reverb = value;
  
  if (audioProcessor.wetGain && audioProcessor.dryGain) {
    audioProcessor.wetGain.gain.value = wetGain;
    audioProcessor.dryGain.gain.value = dryGain;
    console.log('[Slowverb] Reverb updated - wet:', wetGain, 'dry:', dryGain);
  }
}

/**
 * Updates the bass boost filter gain.
 * 
 * Requirements: 4.1
 * 
 * @param {number} value - Bass boost percentage (0 to 100)
 */
function updateBassBoost(value) {
  const gainDb = calculateBassBoostGain(value);
  
  audioProcessor.currentSettings.bassBoost = value;
  
  if (audioProcessor.bassBoostFilter) {
    audioProcessor.bassBoostFilter.gain.value = gainDb;
    console.log('[Slowverb] Bass boost updated to:', gainDb, 'dB');
  }
}

/**
 * Applies all settings to the audio processor.
 * Applies ALL settings, not just changed ones, to ensure correct state after reconnect.
 * 
 * @param {Object} settings - Settings object with speed, reverb, bassBoost
 */
function applySettings(settings) {
  console.log('[Slowverb] Applying settings:', settings);
  
  // Применяем все настройки для гарантии корректного состояния
  const speed = settings.speed ?? audioProcessor.currentSettings.speed;
  const reverb = settings.reverb ?? audioProcessor.currentSettings.reverb;
  const bassBoost = settings.bassBoost ?? audioProcessor.currentSettings.bassBoost;
  const preservePitch = settings.preservePitch ?? audioProcessor.currentSettings.preservePitch;
  
  // preservePitch must be applied first as it affects audio graph routing
  updatePreservePitch(preservePitch);
  updateSpeed(speed);
  updateReverb(reverb);
  updateBassBoost(bassBoost);
  
  console.log('[Slowverb] Settings applied - speed:', speed, 'reverb:', reverb, 'bass:', bassBoost, 'preservePitch:', preservePitch);
}

/**
 * Disconnects all audio nodes and releases resources.
 * Nullifies source and disconnects all nodes from the graph.
 * 
 * Requirements: 6.4 (release audio resources)
 * Property 9: Resource cleanup on disconnect
 */
function disconnect() {
  console.log('[Slowverb] Disconnecting audio processor...');
  
  // Disconnect and nullify source
  if (audioProcessor.source) {
    try {
      audioProcessor.source.disconnect();
    } catch (e) {
      // Ignore errors if already disconnected
    }
    audioProcessor.source = null;
  }
  
  // Stop all tracks in the media stream to release tab capture
  if (audioProcessor.mediaStream) {
    try {
      audioProcessor.mediaStream.getTracks().forEach(track => track.stop());
      console.log('[Slowverb] Media stream tracks stopped');
    } catch (e) {
      // Ignore errors
    }
    audioProcessor.mediaStream = null;
  }
  
  // Disconnect pitch shifter
  if (audioProcessor.pitchShifter) {
    try {
      audioProcessor.pitchShifter.disconnect();
    } catch (e) {
      // Ignore errors if already disconnected
    }
    audioProcessor.pitchShifter = null;
  }
  
  // Disconnect bass boost filter
  if (audioProcessor.bassBoostFilter) {
    try {
      audioProcessor.bassBoostFilter.disconnect();
    } catch (e) {
      // Ignore errors if already disconnected
    }
    audioProcessor.bassBoostFilter = null;
  }
  
  // Disconnect reverb highpass
  if (audioProcessor.reverbHighpass) {
    try {
      audioProcessor.reverbHighpass.disconnect();
    } catch (e) {
      // Ignore errors if already disconnected
    }
    audioProcessor.reverbHighpass = null;
  }
  
  // Disconnect convolver
  if (audioProcessor.convolver) {
    try {
      audioProcessor.convolver.disconnect();
    } catch (e) {
      // Ignore errors if already disconnected
    }
    audioProcessor.convolver = null;
  }
  
  // Disconnect dry gain
  if (audioProcessor.dryGain) {
    try {
      audioProcessor.dryGain.disconnect();
    } catch (e) {
      // Ignore errors if already disconnected
    }
    audioProcessor.dryGain = null;
  }
  
  // Disconnect wet gain
  if (audioProcessor.wetGain) {
    try {
      audioProcessor.wetGain.disconnect();
    } catch (e) {
      // Ignore errors if already disconnected
    }
    audioProcessor.wetGain = null;
  }
  
  // Disconnect output gain
  if (audioProcessor.outputGain) {
    try {
      audioProcessor.outputGain.disconnect();
    } catch (e) {
      // Ignore errors if already disconnected
    }
    audioProcessor.outputGain = null;
  }
  
  // Close AudioContext
  if (audioProcessor.context) {
    try {
      audioProcessor.context.close();
    } catch (e) {
      // Ignore errors if already closed
    }
    audioProcessor.context = null;
  }
  
  // Reset current settings
  audioProcessor.currentSettings = { ...DEFAULT_SETTINGS };
  
  console.log('[Slowverb] Audio processor disconnected and resources released');
}

/**
 * Message types that offscreen document should handle.
 * Other messages should be ignored (passed to service worker).
 */
const OFFSCREEN_MESSAGE_TYPES = [
  MESSAGE_TYPES.START_CAPTURE,
  MESSAGE_TYPES.STOP_CAPTURE,
  MESSAGE_TYPES.UPDATE_AUDIO
];

/**
 * Handles incoming messages from the service worker.
 * Only processes messages intended for offscreen document.
 * 
 * @param {Object} message - Message object with type and payload
 * @param {Object} sender - Message sender info
 * @param {Function} sendResponse - Response callback
 * @returns {boolean|undefined} True for async response, undefined to pass to other listeners
 */
function handleMessage(message, sender, sendResponse) {
  // Ignore messages not intended for offscreen document
  if (!OFFSCREEN_MESSAGE_TYPES.includes(message.type)) {
    return; // Let other listeners handle it
  }
  
  console.log('[Slowverb Offscreen] Received message:', message.type);
  
  try {
    switch (message.type) {
      case MESSAGE_TYPES.START_CAPTURE:
        // Initialize audio context and connect tab audio
        (async () => {
          try {
            await initAudioContext();
            setupAudioGraph();
            await connectTabAudio(message.streamId);
            
            // Apply initial settings if provided
            if (message.settings) {
              applySettings(message.settings);
            }
            
            sendResponse({ success: true });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
        })();
        return true; // Async response
        
      case MESSAGE_TYPES.STOP_CAPTURE:
        disconnect();
        sendResponse({ success: true });
        return false;
        
      case MESSAGE_TYPES.UPDATE_AUDIO:
        if (message.settings) {
          applySettings(message.settings);
        }
        sendResponse({ success: true });
        return false;
    }
  } catch (error) {
    console.error('[Slowverb Offscreen] Error handling message:', error);
    sendResponse({ success: false, error: ERROR_CODES.UNKNOWN_ERROR });
  }
  
  return false;
}

// Set up message listener for service worker communication
chrome.runtime.onMessage.addListener(handleMessage);

console.log('[Slowverb] Offscreen document loaded and ready');

// Export for testing purposes
export {
  audioProcessor,
  initAudioContext,
  setupAudioGraph,
  connectTabAudio,
  connectSourceToGraph,
  updateSpeed,
  updateReverb,
  updateBassBoost,
  updatePreservePitch,
  disconnect,
  applySettings
};

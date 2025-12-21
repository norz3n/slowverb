/**
 * Slowverb Extension - Firefox Content Script (Bundled)
 * 
 * Firefox MV3 content scripts don't support ES modules,
 * so all dependencies are inlined here.
 * 
 * Audio processing happens directly on the page via MediaElementSource.
 */

(function() {
  'use strict';

  // ============================================================================
  // Constants (from constants.js)
  // ============================================================================
  
  const AUDIO_CONSTANTS = {
    bassBoost: {
      frequency: 250,
      maxGainDb: 6,
      filterType: 'lowshelf'
    },
    reverb: {
      defaultDuration: 2.0,
      defaultDecay: 1.0
    },
    context: {
      sampleRate: 44100,
      latencyHint: 'interactive'
    }
  };

  const CONSTRAINTS = {
    bassBoost: { min: 0, max: 100 },
    reverb: { min: 0, max: 100 }
  };

  // ============================================================================
  // Audio Utils (from audio-utils.js)
  // ============================================================================

  /**
   * Calculates wet/dry mix from reverb percentage.
   */
  function calculateWetDryMix(reverbPercent) {
    const clamped = Math.max(CONSTRAINTS.reverb.min, Math.min(CONSTRAINTS.reverb.max, reverbPercent));
    const wetGain = (clamped / 100) * 1.4;
    const dryGain = 1 - (clamped / 400);
    return { wetGain, dryGain };
  }

  /**
   * Calculates bass boost gain in dB.
   */
  function calculateBassBoostGain(percent) {
    const clamped = Math.max(CONSTRAINTS.bassBoost.min, Math.min(CONSTRAINTS.bassBoost.max, percent));
    return clamped * (AUDIO_CONSTANTS.bassBoost.maxGainDb / 100);
  }

  /**
   * Generates impulse response for reverb.
   */
  function generateImpulseResponse(context, duration) {
    const sampleRate = context.sampleRate;
    const irDuration = Math.max(1.5, Math.min(3.0, duration));
    const length = Math.floor(irDuration * sampleRate);
    
    const buffer = context.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    
    for (let i = 0; i < length; i++) {
      const decay = Math.exp(-3 * i / length);
      left[i] = (Math.random() - 0.5) * 2 * decay;
      right[i] = (Math.random() - 0.5) * 2 * decay;
    }
    
    return buffer;
  }

  // ============================================================================
  // Audio Injector State
  // ============================================================================

  /** @type {WeakMap<HTMLMediaElement, Object>} */
  const processedMedia = new WeakMap();
  
  /** @type {AudioContext|null} */
  let sharedContext = null;
  
  let currentSettings = { speed: 1.0, reverb: 0, bassBoost: 0 };
  let isEnabled = false;
  let currentSpeed = 1.0;

  /** @type {WeakSet<HTMLMediaElement>} */
  const monitoredElements = new WeakSet();

  // ============================================================================
  // Audio Graph Functions
  // ============================================================================

  /**
   * Gets or creates shared AudioContext.
   */
  function getAudioContext() {
    if (!sharedContext || sharedContext.state === 'closed') {
      sharedContext = new AudioContext({
        latencyHint: AUDIO_CONSTANTS.context.latencyHint,
        sampleRate: AUDIO_CONSTANTS.context.sampleRate
      });
    }
    return sharedContext;
  }

  /**
   * Creates audio processing graph for a media element.
   */
  function createAudioGraph(media) {
    const ctx = getAudioContext();
    
    const source = ctx.createMediaElementSource(media);
    
    // Bass boost
    const bassBoost = ctx.createBiquadFilter();
    bassBoost.type = AUDIO_CONSTANTS.bassBoost.filterType;
    bassBoost.frequency.value = AUDIO_CONSTANTS.bassBoost.frequency;
    bassBoost.gain.value = calculateBassBoostGain(currentSettings.bassBoost);
    
    // Highpass for reverb
    const reverbHighpass = ctx.createBiquadFilter();
    reverbHighpass.type = 'highpass';
    reverbHighpass.frequency.value = 200;
    reverbHighpass.Q.value = 0.7;
    
    // Convolver
    const convolver = ctx.createConvolver();
    convolver.buffer = generateImpulseResponse(ctx, AUDIO_CONSTANTS.reverb.defaultDuration);
    
    // Dry/wet - используем текущие настройки
    const { wetGain: wetValue, dryGain: dryValue } = calculateWetDryMix(currentSettings.reverb);
    
    const dryGain = ctx.createGain();
    dryGain.gain.value = dryValue;
    
    const wetGain = ctx.createGain();
    wetGain.gain.value = wetValue;
    
    const outputGain = ctx.createGain();
    outputGain.gain.value = 1.0;
    
    // Connect: source → bassBoost → dry/wet → output
    source.connect(bassBoost);
    bassBoost.connect(dryGain);
    bassBoost.connect(reverbHighpass);
    reverbHighpass.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(outputGain);
    wetGain.connect(outputGain);
    outputGain.connect(ctx.destination);
    
    console.log('[Slowverb Firefox] Audio graph created with bassBoost:', currentSettings.bassBoost, 'reverb:', currentSettings.reverb);
    
    return { source, bassBoost, reverbHighpass, convolver, dryGain, wetGain, outputGain };
  }

  /**
   * Processes a media element.
   */
  function processMediaElement(media) {
    if (processedMedia.has(media)) return;
    
    try {
      const nodes = createAudioGraph(media);
      processedMedia.set(media, nodes);
      
      // Apply current playback rate to new element
      if (isEnabled) {
        media.preservesPitch = false;
        media.mozPreservesPitch = false;
        media.playbackRate = currentSpeed;
        monitorMediaElement(media);
      }
      
      console.log('[Slowverb Firefox] Audio graph attached');
    } catch (error) {
      console.error('[Slowverb Firefox] Failed to process media:', error);
    }
  }
  
  /**
   * Handles video source change (YouTube SPA navigation).
   * Re-applies playback rate when video loads new content.
   */
  function handleLoadedData(event) {
    if (!isEnabled) return;
    const media = event.target;
    
    // Re-apply playback rate
    media.preservesPitch = false;
    media.mozPreservesPitch = false;
    media.playbackRate = currentSpeed;
    
    console.log('[Slowverb Firefox] Video source changed, re-applied settings');
  }

  /**
   * Updates settings on all processed media.
   */
  function updateAllMedia(settings) {
    currentSettings = { ...currentSettings, ...settings };
    
    const mediaElements = document.querySelectorAll('video, audio');
    console.log('[Slowverb Firefox] updateAllMedia called, media count:', mediaElements.length, 'settings:', settings);
    
    mediaElements.forEach(media => {
      const nodes = processedMedia.get(media);
      if (!nodes) {
        console.log('[Slowverb Firefox] No nodes for media element');
        return;
      }
      
      if (settings.bassBoost !== undefined) {
        const gainDb = calculateBassBoostGain(settings.bassBoost);
        nodes.bassBoost.gain.value = gainDb;
        console.log('[Slowverb Firefox] Bass boost set to:', gainDb, 'dB');
      }
      
      if (settings.reverb !== undefined) {
        const { wetGain, dryGain } = calculateWetDryMix(settings.reverb);
        nodes.wetGain.gain.value = wetGain;
        nodes.dryGain.gain.value = dryGain;
        console.log('[Slowverb Firefox] Reverb wet/dry:', wetGain, '/', dryGain);
      }
    });
  }

  // ============================================================================
  // Playback Rate Control
  // ============================================================================

  function findMediaElements() {
    return [...document.querySelectorAll('video, audio')];
  }

  function handleRateChange(event) {
    if (!isEnabled) return;
    const media = event.target;
    if (Math.abs(media.playbackRate - currentSpeed) > 0.001) {
      media.playbackRate = currentSpeed;
    }
  }

  function monitorMediaElement(media) {
    if (monitoredElements.has(media)) return;
    media.addEventListener('ratechange', handleRateChange);
    media.addEventListener('loadeddata', handleLoadedData);
    monitoredElements.add(media);
  }

  function setPlaybackRate(rate) {
    findMediaElements().forEach(media => {
      try {
        monitorMediaElement(media);
        media.preservesPitch = false;
        media.mozPreservesPitch = false;
        media.webkitPreservesPitch = false;
        media.playbackRate = rate;
      } catch (e) {
        console.warn('[Slowverb Firefox] Failed to set playbackRate:', e);
      }
    });
  }

  // ============================================================================
  // Enable/Disable
  // ============================================================================

  function enable() {
    if (isEnabled) return;
    isEnabled = true;
    
    if (sharedContext?.state === 'suspended') {
      sharedContext.resume();
    }
    
    document.querySelectorAll('video, audio').forEach(processMediaElement);
    console.log('[Slowverb Firefox] Audio processing enabled');
  }

  function disable() {
    if (!isEnabled) return;
    isEnabled = false;
    
    document.querySelectorAll('video, audio').forEach(media => {
      const nodes = processedMedia.get(media);
      if (!nodes) return;
      
      // Bypass effects
      nodes.bassBoost.gain.value = 0;
      nodes.dryGain.gain.value = 1;
      nodes.wetGain.gain.value = 0;
    });
    
    console.log('[Slowverb Firefox] Audio processing disabled');
  }

  // ============================================================================
  // DOM Observer
  // ============================================================================

  function observeNewMedia() {
    const observer = new MutationObserver(mutations => {
      if (!isEnabled) return;
      
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeName === 'VIDEO' || node.nodeName === 'AUDIO') {
            processMediaElement(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('video, audio').forEach(processMediaElement);
          }
        });
      });
    });
    
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // ============================================================================
  // Message Handler
  // ============================================================================

  function handleMessage(message, sender, sendResponse) {
    console.log('[Slowverb Firefox] Message:', message.type);
    
    switch (message.type) {
      case 'PING':
        sendResponse({ success: true, loaded: true });
        break;
        
      case 'SET_SPEED':
        currentSpeed = message.speed;
        if (isEnabled) setPlaybackRate(currentSpeed);
        sendResponse({ success: true });
        break;
        
      case 'UPDATE_SETTINGS':
        if (isEnabled && message.settings) {
          updateAllMedia(message.settings);
        }
        sendResponse({ success: true });
        break;
        
      case 'ENABLE':
        currentSpeed = message.speed || 1.0;
        // Сначала обновляем настройки, потом создаём аудио граф
        if (message.settings) {
          currentSettings = { ...currentSettings, ...message.settings };
          console.log('[Slowverb Firefox] Settings before enable:', currentSettings);
        }
        // enable() сам установит isEnabled = true
        enable();
        // После создания графа применяем настройки к уже созданным узлам
        if (message.settings) updateAllMedia(message.settings);
        setPlaybackRate(currentSpeed);
        sendResponse({ success: true });
        break;
        
      case 'DISABLE':
        isEnabled = false;
        disable();
        findMediaElements().forEach(media => {
          try {
            media.preservesPitch = true;
            media.mozPreservesPitch = true;
            media.webkitPreservesPitch = true;
            media.playbackRate = 1.0;
          } catch (e) { /* ignore */ }
        });
        sendResponse({ success: true });
        break;
        
      default:
        return;
    }
  }

  // ============================================================================
  // Initialize
  // ============================================================================

  browser.runtime.onMessage.addListener(handleMessage);

  if (document.body) {
    observeNewMedia();
  } else {
    document.addEventListener('DOMContentLoaded', observeNewMedia);
  }

  console.log('[Slowverb Firefox] Content script loaded');
})();

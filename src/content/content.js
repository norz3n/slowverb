/**
 * Slowverb Extension - Content Script
 * 
 * Injected into web pages to control media playback speed.
 * Finds video/audio elements and adjusts their playbackRate.
 * 
 * Requirements: 1.1 (change playback rate)
 */

/**
 * Current playback rate setting.
 * @type {number}
 */
let currentSpeed = 1.0;

/**
 * Whether the extension is enabled for this tab.
 * @type {boolean}
 */
let isEnabled = false;

/**
 * Finds all media elements (video and audio) on the page.
 * 
 * @returns {HTMLMediaElement[]} Array of media elements
 */
function findMediaElements() {
  const videos = Array.from(document.querySelectorAll('video'));
  const audios = Array.from(document.querySelectorAll('audio'));
  return [...videos, ...audios];
}

/**
 * Sets playback rate on all media elements.
 * Disables preservesPitch to get the classic "slowed" pitch-lowering effect.
 * 
 * @param {number} rate - Playback rate (0.5 to 1.5)
 */
function setPlaybackRate(rate) {
  const mediaElements = findMediaElements();
  
  mediaElements.forEach(media => {
    try {
      // Disable pitch preservation for classic Slowed & Reverb effect
      // This makes slower playback = lower pitch (like vinyl/tape)
      media.preservesPitch = false;
      media.mozPreservesPitch = false; // Firefox
      media.webkitPreservesPitch = false; // Older WebKit
      
      media.playbackRate = rate;
    } catch (e) {
      console.warn('[Slowverb] Failed to set playbackRate:', e);
    }
  });
  
  console.log(`[Slowverb] Set playbackRate to ${rate} (preservesPitch=false) on ${mediaElements.length} elements`);
}

/**
 * Observes DOM for new media elements and applies playback rate.
 */
function observeNewMedia() {
  const observer = new MutationObserver((mutations) => {
    if (!isEnabled) return;
    
    let hasNewMedia = false;
    
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeName === 'VIDEO' || node.nodeName === 'AUDIO') {
          hasNewMedia = true;
        }
        // Check children for media elements
        if (node.querySelectorAll) {
          const media = node.querySelectorAll('video, audio');
          if (media.length > 0) {
            hasNewMedia = true;
          }
        }
      });
    });
    
    if (hasNewMedia) {
      setPlaybackRate(currentSpeed);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Handles messages from the service worker.
 * 
 * @param {Object} message - Message object
 * @param {Object} sender - Sender info
 * @param {Function} sendResponse - Response callback
 */
function handleMessage(message, sender, sendResponse) {
  console.log('[Slowverb Content] Received message:', message.type);
  
  switch (message.type) {
    case 'SET_SPEED':
      currentSpeed = message.speed;
      if (isEnabled) {
        setPlaybackRate(currentSpeed);
      }
      sendResponse({ success: true });
      break;
      
    case 'ENABLE':
      isEnabled = true;
      currentSpeed = message.speed || 1.0;
      setPlaybackRate(currentSpeed);
      sendResponse({ success: true });
      break;
      
    case 'DISABLE':
      isEnabled = false;
      // Reset to normal speed and restore pitch preservation
      const mediaElements = findMediaElements();
      mediaElements.forEach(media => {
        try {
          media.preservesPitch = true;
          media.mozPreservesPitch = true;
          media.webkitPreservesPitch = true;
          media.playbackRate = 1.0;
        } catch (e) {
          // Ignore
        }
      });
      sendResponse({ success: true });
      break;
      
    default:
      // Ignore unknown messages
      return;
  }
}

// Set up message listener
chrome.runtime.onMessage.addListener(handleMessage);

// Start observing for new media elements
if (document.body) {
  observeNewMedia();
} else {
  document.addEventListener('DOMContentLoaded', observeNewMedia);
}

console.log('[Slowverb] Content script loaded');

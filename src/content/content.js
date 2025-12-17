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
 * WeakSet to track media elements we've attached ratechange listener to.
 * @type {WeakSet<HTMLMediaElement>}
 */
const monitoredElements = new WeakSet();

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
 * Handles ratechange event on media elements.
 * Reverts playbackRate if YouTube or other site tries to change it.
 * 
 * @param {Event} event - ratechange event
 */
function handleRateChange(event) {
  if (!isEnabled) return;
  
  const media = event.target;
  // If the rate doesn't match our setting, revert it
  if (Math.abs(media.playbackRate - currentSpeed) > 0.001) {
    console.log(`[Slowverb] Reverting playbackRate from ${media.playbackRate} to ${currentSpeed}`);
    media.playbackRate = currentSpeed;
  }
}

/**
 * Debounce timer for media change notifications.
 * @type {number|null}
 */
let mediaChangeTimer = null;

/**
 * Notifies service worker that media source changed.
 * This triggers audio recapture for the new video.
 * Debounced to avoid multiple rapid notifications.
 */
function notifyMediaChanged() {
  if (!isEnabled) return;
  
  // Debounce - only notify once per 1 second
  if (mediaChangeTimer) {
    clearTimeout(mediaChangeTimer);
  }
  
  mediaChangeTimer = setTimeout(() => {
    console.log('[Slowverb] Media source changed, requesting recapture');
    chrome.runtime.sendMessage({ type: 'MEDIA_CHANGED' }).catch(e => {
      // Service worker may not be ready
    });
    mediaChangeTimer = null;
  }, 1000);
}

/**
 * Attaches ratechange listener to media element if not already attached.
 * Also monitors for source changes.
 * 
 * @param {HTMLMediaElement} media - Media element to monitor
 */
function monitorMediaElement(media) {
  if (monitoredElements.has(media)) return;
  
  media.addEventListener('ratechange', handleRateChange);
  
  // Monitor for video source changes (YouTube video switch)
  // emptied fires when media is reset, loadeddata fires when new data is ready
  media.addEventListener('emptied', () => {
    console.log('[Slowverb] Media emptied detected');
    notifyMediaChanged();
  });
  
  media.addEventListener('loadeddata', () => {
    console.log('[Slowverb] Media loadeddata detected');
    // Re-apply playback rate to new video
    if (isEnabled) {
      setPlaybackRate(currentSpeed);
    }
  });
  
  monitoredElements.add(media);
}

/**
 * Sets playback rate on all media elements.
 * preservesPitch is always false for classic "slowed" effect (lower pitch with slower speed).
 * 
 * @param {number} rate - Playback rate (0.5 to 1.5)
 */
function setPlaybackRate(rate) {
  const mediaElements = findMediaElements();
  
  mediaElements.forEach(media => {
    try {
      // Monitor for external rate changes (YouTube likes to reset playbackRate)
      monitorMediaElement(media);
      
      // Classic Slowed & Reverb: slower = lower pitch
      media.preservesPitch = false;
      media.mozPreservesPitch = false; // Firefox
      media.webkitPreservesPitch = false; // Older WebKit
      
      media.playbackRate = rate;
    } catch (e) {
      console.warn('[Slowverb] Failed to set playbackRate:', e);
    }
  });
  
  console.log(`[Slowverb] Set playbackRate to ${rate} on ${mediaElements.length} elements`);
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
    case 'PING':
      // Used to check if content script is loaded
      sendResponse({ success: true, loaded: true });
      break;
      
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

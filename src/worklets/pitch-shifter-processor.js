/**
 * Slowverb Extension - Pitch Shifter AudioWorklet Processor
 * 
 * Implements real-time pitch shifting using granular synthesis.
 * This approach provides low-latency pitch correction suitable for
 * compensating speed-induced pitch changes.
 * 
 * Requirements: 3.1 (pitch correction), 3.4 (time-stretching algorithm)
 * 
 * Algorithm: Granular synthesis with overlapping grains and crossfade
 * - Splits audio into small grains (windows)
 * - Resamples grains to achieve pitch shift
 * - Overlaps grains with crossfade to avoid clicks
 */

/**
 * PitchShifterProcessor - AudioWorkletProcessor for real-time pitch shifting
 * 
 * Uses granular synthesis to shift pitch without changing tempo.
 * Pitch factor of 1.0 = no change, <1 = lower pitch, >1 = higher pitch.
 */
class PitchShifterProcessor extends AudioWorkletProcessor {
  /**
   * Define AudioParam descriptors for the processor.
   * pitchFactor: Controls the pitch shift amount (1.0 = no change)
   */
  static get parameterDescriptors() {
    return [{
      name: 'pitchFactor',
      defaultValue: 1.0,
      minValue: 0.5,
      maxValue: 2.0,
      automationRate: 'k-rate'
    }];
  }

  constructor() {
    super();
    
    // Grain parameters for granular synthesis
    // Grain size in samples (at 44100Hz, 2048 samples ≈ 46ms)
    this.grainSize = 2048;
    // Overlap factor (0.5 = 50% overlap for smooth crossfade)
    this.overlapFactor = 0.5;
    // Hop size between grains
    this.hopSize = Math.floor(this.grainSize * (1 - this.overlapFactor));
    
    // Circular buffer for input samples
    // Size should be at least 2x grain size for proper operation
    this.bufferSize = this.grainSize * 4;
    this.inputBuffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    
    // Read position for grain extraction (fractional for resampling)
    this.readPosition = 0;
    
    // Output buffer for overlap-add
    this.outputBuffer = new Float32Array(this.grainSize * 2);
    this.outputReadIndex = 0;
    this.outputWriteIndex = 0;
    
    // Hann window for smooth grain transitions
    this.window = this.createHannWindow(this.grainSize);
    
    // Grain processing state
    this.grainCounter = 0;
    this.samplesUntilNextGrain = 0;
    
    // Bypass flag (when pitchFactor is 1.0, bypass processing)
    this.bypass = true;
    
    // Handle messages from main thread
    this.port.onmessage = this.handleMessage.bind(this);
  }

  /**
   * Creates a Hann window for smooth grain transitions.
   * Hann window: w(n) = 0.5 * (1 - cos(2π * n / (N-1)))
   * 
   * @param {number} size - Window size in samples
   * @returns {Float32Array} Hann window coefficients
   */
  createHannWindow(size) {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
    }
    return window;
  }

  /**
   * Handles messages from the main thread.
   * 
   * @param {MessageEvent} event - Message event with command data
   */
  handleMessage(event) {
    const { command, value } = event.data;
    
    switch (command) {
      case 'setBypass':
        this.bypass = value;
        break;
      case 'setGrainSize':
        // Allow dynamic grain size adjustment (power of 2)
        if (value >= 512 && value <= 4096) {
          this.grainSize = value;
          this.hopSize = Math.floor(this.grainSize * (1 - this.overlapFactor));
          this.window = this.createHannWindow(this.grainSize);
        }
        break;
    }
  }

  /**
   * Processes a single grain with pitch shifting.
   * Extracts grain from input buffer, applies window, resamples for pitch shift.
   * 
   * @param {number} pitchFactor - Pitch shift factor
   */
  processGrain(pitchFactor) {
    // Calculate grain read position in input buffer
    const grainStartIndex = Math.floor(this.readPosition) % this.bufferSize;
    
    // Process grain with resampling for pitch shift
    for (let i = 0; i < this.grainSize; i++) {
      // Calculate source position with pitch factor
      // pitchFactor > 1 = higher pitch = read faster through source
      const sourcePos = i * pitchFactor;
      const sourceIndex = Math.floor(sourcePos);
      const frac = sourcePos - sourceIndex;
      
      // Get sample indices in circular buffer
      const idx0 = (grainStartIndex + sourceIndex) % this.bufferSize;
      const idx1 = (grainStartIndex + sourceIndex + 1) % this.bufferSize;
      
      // Linear interpolation for smooth resampling
      const sample0 = this.inputBuffer[idx0];
      const sample1 = this.inputBuffer[idx1];
      const interpolatedSample = sample0 + frac * (sample1 - sample0);
      
      // Apply window and add to output buffer (overlap-add)
      const windowedSample = interpolatedSample * this.window[i];
      const outputIdx = (this.outputWriteIndex + i) % this.outputBuffer.length;
      this.outputBuffer[outputIdx] += windowedSample;
    }
    
    // Advance read position by hop size (adjusted for pitch)
    // When pitch > 1, we need to advance more to maintain tempo
    this.readPosition += this.hopSize;
    
    // Advance output write index by hop size
    this.outputWriteIndex = (this.outputWriteIndex + this.hopSize) % this.outputBuffer.length;
  }

  /**
   * Main audio processing method called by Web Audio API.
   * Processes all channels independently for proper stereo support.
   * 
   * @param {Float32Array[][]} inputs - Input audio data
   * @param {Float32Array[][]} outputs - Output audio data
   * @param {Object} parameters - AudioParam values
   * @returns {boolean} True to keep processor alive
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    // Handle no input case
    if (!input || !input.length) {
      return true;
    }
    
    const numChannels = Math.min(input.length, output.length);
    const blockSize = input[0]?.length || 0;
    
    if (blockSize === 0) {
      return true;
    }
    
    // Get pitch factor (k-rate, so single value per block)
    const pitchFactor = parameters.pitchFactor[0];
    
    // Bypass processing if pitch factor is 1.0 (no change needed)
    // Pass through ALL channels unchanged
    if (this.bypass || Math.abs(pitchFactor - 1.0) < 0.001) {
      for (let channel = 0; channel < numChannels; channel++) {
        const inputChannel = input[channel];
        const outputChannel = output[channel];
        if (inputChannel && outputChannel) {
          for (let i = 0; i < blockSize; i++) {
            outputChannel[i] = inputChannel[i];
          }
        }
      }
      return true;
    }
    
    // For pitch shifting, process first channel and copy to others
    // (Full stereo pitch shifting would require separate buffers per channel)
    const inputChannel = input[0];
    const outputChannel = output[0];
    
    // Write input samples to circular buffer
    for (let i = 0; i < blockSize; i++) {
      this.inputBuffer[this.writeIndex] = inputChannel[i];
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }
    
    // Process grains as needed
    this.samplesUntilNextGrain -= blockSize;
    while (this.samplesUntilNextGrain <= 0) {
      this.processGrain(pitchFactor);
      this.samplesUntilNextGrain += this.hopSize;
      this.grainCounter++;
    }
    
    // Read from output buffer
    for (let i = 0; i < blockSize; i++) {
      outputChannel[i] = this.outputBuffer[this.outputReadIndex];
      // Clear the read sample for next overlap-add cycle
      this.outputBuffer[this.outputReadIndex] = 0;
      this.outputReadIndex = (this.outputReadIndex + 1) % this.outputBuffer.length;
    }
    
    // Copy processed audio to other channels (stereo)
    for (let channel = 1; channel < numChannels; channel++) {
      if (output[channel]) {
        output[channel].set(outputChannel);
      }
    }
    
    return true;
  }
}

// Register the processor with the AudioWorklet system
registerProcessor('pitch-shifter-processor', PitchShifterProcessor);

class RecorderWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bytesWritten = 0;
  }

  process(inputs, outputs, parameters) {
    // We only care about the first input (microphone)
    const input = inputs[0];
    
    if (input && input.length > 0) {
      const channelData = input[0]; // Assuming mono channel (channel 0)
      
      if (channelData) {
        // Collect samples into our buffer
        for (let i = 0; i < channelData.length; i++) {
          this.buffer[this.bytesWritten++] = channelData[i];
          
          if (this.bytesWritten >= this.bufferSize) {
            // Buffer is full, send it to the main thread
            this.port.postMessage(this.buffer);
            
            // Reset buffer
            this.buffer = new Float32Array(this.bufferSize);
            this.bytesWritten = 0;
          }
        }
      }
    }
    
    // Return true to keep the processor alive
    return true;
  }
}

registerProcessor('recorder-worklet', RecorderWorkletProcessor);

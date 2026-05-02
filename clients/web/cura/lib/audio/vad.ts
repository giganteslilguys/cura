/**
 * Voice activity detection used to gate Whisper requests.
 *
 * The MediaRecorder samples the mic in fixed windows. While each chunk is
 * being recorded we sample the analyser node every 100 ms. We treat a frame
 * as speech if its peak frequency amplitude crosses `SPEECH_THRESHOLD`, and
 * accept the chunk only if at least `SPEECH_FRAMES_REQUIRED` of those samples
 * landed above the threshold. This prevents Whisper from hallucinating on
 * silent or near-silent windows.
 */
export const SPEECH_THRESHOLD = 80; // 0–255 peak frequency amplitude
export const SPEECH_FRAMES_REQUIRED = 2; // 2 × 100 ms = 200 ms of real speech
export const MIN_CHUNK_BYTES = 500;

/** Returns true when the given frequency frame contains speech-level energy. */
export function isSpeechFrame(
  freqData: ArrayLike<number>,
  threshold: number = SPEECH_THRESHOLD,
): boolean {
  let peak = 0;
  for (let i = 0; i < freqData.length; i++) {
    const v = freqData[i] ?? 0;
    if (v > peak) peak = v;
  }
  return peak > threshold;
}

/** Returns true when a recorded chunk should be sent to Whisper. */
export function shouldEmitChunk(params: {
  speechFrames: number;
  byteSize: number;
  framesRequired?: number;
  minBytes?: number;
}): boolean {
  const {
    speechFrames,
    byteSize,
    framesRequired = SPEECH_FRAMES_REQUIRED,
    minBytes = MIN_CHUNK_BYTES,
  } = params;

  return speechFrames >= framesRequired && byteSize >= minBytes;
}

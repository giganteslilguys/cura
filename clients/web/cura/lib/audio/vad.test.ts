import { describe, expect, it } from "bun:test";

import {
  MIN_CHUNK_BYTES,
  SPEECH_FRAMES_REQUIRED,
  SPEECH_THRESHOLD,
  isSpeechFrame,
  shouldEmitChunk,
} from "./vad";

function frame(peak: number, length = 16): Uint8Array {
  const data = new Uint8Array(length);
  // Place the peak in the middle so we also exercise the scan loop.
  data[Math.floor(length / 2)] = peak;
  return data;
}

describe("isSpeechFrame", () => {
  it("returns false for silence", () => {
    expect(isSpeechFrame(new Uint8Array(16))).toBe(false);
  });

  it("returns false at the threshold (strict >)", () => {
    expect(isSpeechFrame(frame(SPEECH_THRESHOLD))).toBe(false);
  });

  it("returns true above the threshold", () => {
    expect(isSpeechFrame(frame(SPEECH_THRESHOLD + 1))).toBe(true);
  });

  it("honours a custom threshold", () => {
    expect(isSpeechFrame(frame(40), 30)).toBe(true);
    expect(isSpeechFrame(frame(40), 50)).toBe(false);
  });
});

describe("shouldEmitChunk", () => {
  it("emits when both energy and size cross thresholds", () => {
    expect(
      shouldEmitChunk({
        speechFrames: SPEECH_FRAMES_REQUIRED,
        byteSize: MIN_CHUNK_BYTES,
      }),
    ).toBe(true);
  });

  it("drops chunks with too few speech frames", () => {
    expect(
      shouldEmitChunk({
        speechFrames: SPEECH_FRAMES_REQUIRED - 1,
        byteSize: MIN_CHUNK_BYTES * 10,
      }),
    ).toBe(false);
  });

  it("drops chunks with too few bytes", () => {
    expect(
      shouldEmitChunk({
        speechFrames: SPEECH_FRAMES_REQUIRED * 10,
        byteSize: MIN_CHUNK_BYTES - 1,
      }),
    ).toBe(false);
  });

  it("respects custom thresholds", () => {
    expect(
      shouldEmitChunk({
        speechFrames: 5,
        byteSize: 100,
        framesRequired: 5,
        minBytes: 100,
      }),
    ).toBe(true);
    expect(
      shouldEmitChunk({
        speechFrames: 4,
        byteSize: 100,
        framesRequired: 5,
        minBytes: 100,
      }),
    ).toBe(false);
  });
});

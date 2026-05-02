import type { Channel } from "phoenix";

import type { Suggestion } from "./types";

/**
 * Typed event payloads broadcast by the Phoenix backend.
 *
 * Keep this in lockstep with the corresponding Elixir channels under
 * `api/cura/lib/cura_web/channels`. New events go in the matching
 * map and gain type-safety at every call site for free.
 */

export type RoomEvents = {
  presence_state: PresenceState;
  presence_diff: PresenceDiff;
  signal: SignalPayload;
};

export type ConversationEvents = {
  transcript_update: {
    text: string;
    speaker: "doctor" | "patient";
    timestamp: string;
  };
  suggestions_update: {
    suggestions: Suggestion[];
  };
};

export type SignalPayload = {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export type PresenceState = Record<
  string,
  { metas: Array<Record<string, unknown>> }
>;

export type PresenceDiff = {
  joins: PresenceState;
  leaves: PresenceState;
};

/**
 * Type-safe wrapper around `Channel.on`.
 *
 * The plain `phoenix` types accept any payload, so callers tend to inline
 * `({ x }: { x: string })` annotations on every handler. This helper pins
 * the payload shape from the channel-events map for a given event name.
 */
export function typedOn<E extends Record<string, unknown>, K extends keyof E & string>(
  channel: Channel,
  event: K,
  handler: (payload: E[K]) => void,
): void {
  channel.on(event, handler as (payload: object) => void);
}

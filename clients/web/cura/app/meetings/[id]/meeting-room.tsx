"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Channel, Socket } from "phoenix";

import { PUBLIC_SOCKET_URL } from "@/lib/api/config";
import type { Meeting, User } from "@/lib/api/types";

const PC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

type Props = {
  meeting: Meeting;
  currentUser: User;
  token: string;
};

type ConnState = "idle" | "waiting" | "connecting" | "connected" | "failed";

type SignalPayload = {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type PresenceState = Record<string, { metas: Array<Record<string, unknown>> }>;

export function MeetingRoom({ meeting, currentUser, token }: Props) {
  const router = useRouter();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<Channel | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [connState, setConnState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);

  const otherParticipant =
    currentUser.id === meeting.doctor?.id ? meeting.patient : meeting.doctor;

  // Deterministic caller: lower user id makes the offer, the other side
  // answers. No glare possible, no perfect-negotiation choreography needed.
  const isCaller = currentUser.id < (otherParticipant?.id ?? "￿");

  useEffect(() => {
    let cancelled = false;
    let peerPresent = false;
    let didCall = false;
    const pendingCandidates: RTCIceCandidateInit[] = [];

    const start = async () => {
      setConnState("waiting");

      // 1. local media
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? `Could not access camera/microphone: ${err.message}`
            : "Could not access camera/microphone.",
        );
        setConnState("failed");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      // 2. peer connection — tracks attached up-front so the SDP shape is
      // identical on both sides regardless of who calls first.
      const pc = new RTCPeerConnection(PC_CONFIG);
      pcRef.current = pc;
      for (const track of stream.getTracks()) pc.addTrack(track, stream);

      pc.ontrack = (event) => {
        const [remote] = event.streams;
        if (remote && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remote;
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) return;
        channelRef.current?.push("signal", { candidate: candidate.toJSON() });
      };

      pc.onconnectionstatechange = () => {
        if (cancelled) return;
        switch (pc.connectionState) {
          case "connected":
            setConnState("connected");
            break;
          case "connecting":
            setConnState("connecting");
            break;
          case "failed":
            setConnState("failed");
            pc.restartIce();
            break;
        }
      };

      const drainPendingCandidates = async () => {
        while (pendingCandidates.length) {
          const c = pendingCandidates.shift()!;
          try {
            await pc.addIceCandidate(c);
          } catch (err) {
            console.error("addIceCandidate (drain) failed:", err);
          }
        }
      };

      const callIfReady = async () => {
        if (!peerPresent || didCall || !isCaller) return;
        didCall = true;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channelRef.current?.push("signal", {
            description: pc.localDescription,
          });
        } catch (err) {
          console.error("createOffer failed:", err);
        }
      };

      // 3. signaling channel
      const socket = new Socket(`${PUBLIC_SOCKET_URL}/socket`, {
        params: { token },
      });
      socket.connect();
      socketRef.current = socket;

      const channel = socket.channel(`room:${meeting.id}`);
      channelRef.current = channel;

      const onPresence = (state: PresenceState) => {
        const others = Object.keys(state).filter((id) => id !== currentUser.id);
        if (others.length > 0 && !peerPresent) {
          peerPresent = true;
          callIfReady();
        } else if (others.length === 0 && peerPresent) {
          peerPresent = false;
          didCall = false;
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        }
      };

      channel.on("presence_state", (state: PresenceState) => onPresence(state));

      channel.on(
        "presence_diff",
        (diff: { joins: PresenceState; leaves: PresenceState }) => {
          for (const id of Object.keys(diff.joins)) {
            if (id !== currentUser.id && !peerPresent) {
              peerPresent = true;
              callIfReady();
            }
          }
          for (const id of Object.keys(diff.leaves)) {
            if (id !== currentUser.id) {
              peerPresent = false;
              didCall = false;
              if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            }
          }
        },
      );

      channel.on("signal", async (payload: SignalPayload) => {
        if (payload.from === currentUser.id) return;
        try {
          if (payload.description) {
            await pc.setRemoteDescription(payload.description);
            if (payload.description.type === "offer") {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              channel.push("signal", { description: pc.localDescription });
            }
            await drainPendingCandidates();
          } else if (payload.candidate) {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(payload.candidate);
            } else {
              pendingCandidates.push(payload.candidate);
            }
          }
        } catch (err) {
          console.error("signal handling failed:", err);
        }
      });

      channel.join().receive("error", ({ reason }: { reason: string }) => {
        if (cancelled) return;
        setError(`Could not join room: ${reason}`);
        setConnState("failed");
      });
    };

    start();

    return () => {
      cancelled = true;
      try {
        channelRef.current?.leave();
      } catch {}
      try {
        socketRef.current?.disconnect();
      } catch {}
      try {
        pcRef.current?.close();
      } catch {}
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const audio = localStreamRef.current?.getAudioTracks()[0];
    if (!audio) return;
    audio.enabled = !audio.enabled;
    setMuted(!audio.enabled);
  };

  const toggleVideo = () => {
    const video = localStreamRef.current?.getVideoTracks()[0];
    if (!video) return;
    video.enabled = !video.enabled;
    setVideoOff(!video.enabled);
  };

  const endCall = () => router.push("/meetings");

  const status =
    {
      idle: "Starting…",
      waiting: "Waiting for the other participant…",
      connecting: "Connecting…",
      connected: "Connected",
      failed: "Connection failed",
    }[connState] ?? "";

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex flex-col">
          <h1 className="font-semibold">{meeting.title}</h1>
          <span className="text-xs text-zinc-400">{status}</span>
        </div>
        {otherParticipant && (
          <span className="text-sm text-zinc-400">
            with {otherParticipant.first_name} {otherParticipant.last_name}
          </span>
        )}
      </header>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        <Tile label={`${currentUser.first_name} (you)`} muted={muted} videoOff={videoOff}>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover bg-black"
          />
        </Tile>

        <Tile
          label={
            otherParticipant
              ? `${otherParticipant.first_name} ${otherParticipant.last_name}`
              : "Participant"
          }
          waiting={connState !== "connected"}
        >
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover bg-black"
          />
        </Tile>
      </main>

      {error && (
        <div className="px-6 py-3 bg-red-900/40 border-t border-red-800 text-sm">
          {error}
        </div>
      )}

      <footer className="flex items-center justify-center gap-3 px-6 py-4 border-t border-zinc-800">
        <button
          onClick={toggleMute}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            muted ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-100"
          }`}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={toggleVideo}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            videoOff ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-100"
          }`}
        >
          {videoOff ? "Camera on" : "Camera off"}
        </button>
        <button
          onClick={endCall}
          className="px-4 py-2 rounded-md bg-red-700 text-white text-sm font-medium"
        >
          Leave
        </button>
      </footer>
    </div>
  );
}

function Tile({
  label,
  children,
  muted,
  videoOff,
  waiting,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
  videoOff?: boolean;
  waiting?: boolean;
}) {
  return (
    <div className="relative rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800">
      {children}
      {(videoOff || waiting) && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm pointer-events-none">
          {waiting ? "Waiting…" : "Camera off"}
        </div>
      )}
      <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-xs">
        {label}
        {muted && <span className="ml-2 text-red-400">muted</span>}
      </div>
    </div>
  );
}

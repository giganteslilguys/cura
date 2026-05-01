"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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

type ConnState = "idle" | "connecting" | "connected" | "failed" | "disconnected";

export function MeetingRoom({ meeting, currentUser, token }: Props) {
  const router = useRouter();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<Channel | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioStreamRef = useRef<MediaStream | null>(null);
  const tracksAttachedRef = useRef(false);
  const endingRef = useRef(false);

  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [connState, setConnState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasRemote, setHasRemote] = useState(false);

  // ---- Track attachment (replaceTrack on existing senders) -----------------
  const attachLocalTracks = useCallback(
    async (pc: RTCPeerConnection, offerSdp: string) => {
      const stream = localStreamRef.current;
      if (!stream || tracksAttachedRef.current) return;

      const videoTrack = stream.getVideoTracks()[0] ?? null;
      const audioTrack = stream.getAudioTracks()[0] ?? null;

      // Parse m-line kinds in order. Some browsers null out
      // receiver.track when the local direction settles to sendonly,
      // so we can't rely on `transceiver.receiver.track?.kind`.
      const kinds = offerSdp
        .split(/\r?\n/)
        .filter((line) => line.startsWith("m="))
        .map((line) => line.slice(2).split(/\s+/)[0]);

      const transceivers = pc.getTransceivers();
      let videoAssigned = false;
      let audioAssigned = false;

      for (let i = 0; i < transceivers.length; i++) {
        const t = transceivers[i];
        if (t.sender.track) continue;
        // Skip transceivers that the server is using to send to us.
        if (t.direction === "recvonly" || t.direction === "inactive") continue;

        const kind = kinds[i] ?? t.receiver.track?.kind;

        if (kind === "video" && videoTrack && !videoAssigned) {
          await t.sender.replaceTrack(videoTrack);
          try {
            t.direction = "sendonly";
          } catch {}
          videoAssigned = true;
        } else if (kind === "audio" && audioTrack && !audioAssigned) {
          await t.sender.replaceTrack(audioTrack);
          try {
            t.direction = "sendonly";
          } catch {}
          audioAssigned = true;
        }
      }

      if (videoTrack && !videoAssigned) pc.addTrack(videoTrack, stream);
      if (audioTrack && !audioAssigned) pc.addTrack(audioTrack, stream);

      tracksAttachedRef.current = true;
    },
    [],
  );

  // ---- Setup --------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      setConnState("connecting");

      // 1. Local media
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

      // 2. RTCPeerConnection
      const pc = new RTCPeerConnection(PC_CONFIG);
      pcRef.current = pc;

      pc.ontrack = (event) => {
        const track = event.track;
        if (track.kind === "video") {
          if (!remoteStreamRef.current) {
            remoteStreamRef.current = new MediaStream();
            if (remoteVideoRef.current)
              remoteVideoRef.current.srcObject = remoteStreamRef.current;
          }
          remoteStreamRef.current.addTrack(track);
          setHasRemote(true);
        } else if (track.kind === "audio") {
          if (!remoteAudioStreamRef.current) {
            remoteAudioStreamRef.current = new MediaStream();
            if (remoteAudioRef.current)
              remoteAudioRef.current.srcObject = remoteAudioStreamRef.current;
          }
          remoteAudioStreamRef.current.addTrack(track);
          remoteAudioRef.current?.play().catch(() => {});
        }
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        channelRef.current?.push("ice_candidate", {
          body: JSON.stringify(event.candidate),
        });
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
            if (!endingRef.current) pc.restartIce();
            break;
          case "disconnected":
            setConnState("disconnected");
            break;
        }
      };

      // 3. Phoenix socket + signalling channel
      const socket = new Socket(`${PUBLIC_SOCKET_URL}/socket`, {
        params: { token },
      });
      socket.connect();
      socketRef.current = socket;

      const channel = socket.channel(`peer:signalling:${meeting.id}`);
      channelRef.current = channel;

      channel.on("sdp_offer", async (payload: { body: string }) => {
        const sdp = payload.body;
        try {
          if (pc.signalingState === "have-local-offer") {
            await pc.setLocalDescription({ type: "rollback" });
          }
          await pc.setRemoteDescription({ type: "offer", sdp });
          await attachLocalTracks(pc, sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.push("sdp_answer", { body: answer.sdp });
        } catch (err) {
          console.error("Failed to handle SDP offer:", err);
        }
      });

      channel.on("sdp_answer", async (payload: { body: string }) => {
        try {
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription({
              type: "answer",
              sdp: payload.body,
            });
          }
        } catch (err) {
          console.error("Failed to handle SDP answer:", err);
        }
      });

      channel.on("ice_candidate", (payload: { body: string }) => {
        const cand = JSON.parse(payload.body);
        pc.addIceCandidate(cand).catch((err) => {
          console.error("Failed to add ICE candidate:", err);
        });
      });

      channel.on("presence_diff", () => {
        // No-op for now; presence count UI not implemented.
      });

      channel
        .join()
        .receive("error", ({ reason }: { reason: string }) => {
          if (cancelled) return;
          setError(`Could not join room: ${reason}`);
          setConnState("failed");
        });
    };

    start();

    return () => {
      cancelled = true;
      endingRef.current = true;
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
      remoteStreamRef.current = null;
      remoteAudioStreamRef.current = null;
    };
    // We intentionally only run setup once on mount — meeting.id and token
    // are stable for the lifetime of this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Controls -----------------------------------------------------------
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

  const endCall = () => {
    endingRef.current = true;
    router.push("/meetings");
  };

  // ---- Render -------------------------------------------------------------
  const otherParticipant =
    currentUser.id === meeting.doctor?.id ? meeting.patient : meeting.doctor;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex flex-col">
          <h1 className="font-semibold">{meeting.title}</h1>
          <span className="text-xs text-zinc-400">
            {connState === "connected"
              ? "Connected"
              : connState === "connecting"
                ? "Connecting…"
                : connState === "failed"
                  ? "Connection failed"
                  : connState === "disconnected"
                    ? "Disconnected"
                    : "Waiting…"}
          </span>
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
          waiting={!hasRemote}
        >
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover bg-black"
          />
          <audio ref={remoteAudioRef} autoPlay className="hidden" />
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
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
          {waiting ? "Waiting for participant…" : "Camera off"}
        </div>
      )}
      <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-xs">
        {label}
        {muted && <span className="ml-2 text-red-400">muted</span>}
      </div>
    </div>
  );
}

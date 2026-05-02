"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, RefObject } from "react";
import { Channel, Socket } from "phoenix";

import { PUBLIC_SOCKET_URL } from "@/lib/api/config";
import { submitMeetingIntake } from "@/lib/api/meetings";
import type { Meeting, PatientIntake, User } from "@/lib/api/types";

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

type TranscriptEntry = { time: string; text: string; speaker: "doctor" | "patient" };

type MeetingPhase = "pre" | "active" | "post";

function getMeetingPhase(meeting: Meeting): MeetingPhase {
  if (
    meeting.status === "completed" ||
    meeting.status === "canceled" ||
    meeting.status === "rejected"
  ) {
    return "post";
  }
  const now = Date.now();
  const start = new Date(`${meeting.date}T${meeting.time}`).getTime();
  const end = start + meeting.duration * 60 * 1000;
  if (now >= end) return "post";
  return "active";
}

function getTimeUntilStart(meeting: Meeting): string | null {
  const start = new Date(`${meeting.date}T${meeting.time}`).getTime();
  const diff = start - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const MOCK_SUGGESTIONS = [
  { id: 1, text: "Consider asking about sleep quality — fatigue mentioned" },
  { id: 2, text: "Confirm medication adherence" },
  { id: 3, text: "BP slightly elevated — discuss stress levels" },
];

export function MeetingRoom({ meeting, currentUser, token }: Props) {
  const router = useRouter();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<Channel | null>(null);
  const conversationChannelRef = useRef<Channel | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);

  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [connState, setConnState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [phase, setPhase] = useState<MeetingPhase>(() => getMeetingPhase(meeting));

  const isDoctor = currentUser.role === "doctor";
  const otherParticipant = isDoctor ? meeting.patient : meeting.doctor;

  // Re-evaluate phase every 5 s so the view auto-transitions without a reload.
  useEffect(() => {
    if (phase === "post") return;
    const id = setInterval(() => {
      const next = getMeetingPhase(meeting);
      if (next !== phase) setPhase(next);
    }, 5_000);
    return () => clearInterval(id);
  }, [phase, meeting]);

  // Deterministic caller: lower user id makes the offer, the other side
  // answers. No glare possible, no perfect-negotiation choreography needed.
  const isCaller = currentUser.id < (otherParticipant?.id ?? "￿");

  useEffect(() => {
    if (phase !== "active") return;
    let cancelled = false;
    let peerPresent = false;
    let didCall = false;
    let pendingCandidates: RTCIceCandidateInit[] = [];

    // Creates a fresh RTCPeerConnection wired to the local stream and the
    // shared refs/callbacks. Called once at startup and again whenever the
    // remote peer leaves so the next offer arrives into a clean PC with no
    // stale ICE credentials.
    const makePc = (stream: MediaStream) => {
      pcRef.current?.close();
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
            if (isCaller) pc.restartIce();
            break;
        }
      };

      // When restartIce() is called it fires negotiationneeded. The caller
      // must create a new offer with the ICE restart flag so the remote peer
      // learns the new ufrag; otherwise every incoming candidate is rejected.
      pc.onnegotiationneeded = async () => {
        if (!isCaller || !peerPresent || cancelled) return;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channelRef.current?.push("signal", { description: pc.localDescription });
        } catch (err) {
          console.error("onnegotiationneeded offer failed:", err);
        }
      };
    };

    const drainPendingCandidates = async () => {
      const pc = pcRef.current;
      if (!pc) return;
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
      const pc = pcRef.current;
      if (!peerPresent || didCall || !isCaller || !pc) return;
      didCall = true;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        channelRef.current?.push("signal", { description: pc.localDescription });
      } catch (err) {
        console.error("createOffer failed:", err);
      }
    };

    const resetPeer = (stream: MediaStream) => {
      peerPresent = false;
      didCall = false;
      pendingCandidates = [];
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setConnState("waiting");
      makePc(stream);
    };

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

      // 2. initial peer connection
      makePc(stream);

      // 3. signaling channel
      const socket = new Socket(`${PUBLIC_SOCKET_URL}/socket`, {
        params: { token },
      });
      socket.connect();
      socketRef.current = socket;

      const channel = socket.channel(`room:${meeting.id}`);
      channelRef.current = channel;

      // Conversation channel — audio transcription
      const convChannel = socket.channel(`conversation:${meeting.id}`);
      conversationChannelRef.current = convChannel;

      convChannel.on("transcript_update", ({ text, speaker, timestamp }: { text: string; speaker: "doctor" | "patient"; timestamp: string }) => {
        if (cancelled) return;
        const date = new Date(timestamp);
        const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        setTranscript((prev) => [...prev, { time, text, speaker }]);
      });

      convChannel.join();

      // Audio capture: record 15-second chunks and send to Whisper via conversation channel.
      // A VAD (voice activity detection) analyser gates each chunk — silent windows are
      // dropped before they reach the network, preventing Whisper hallucinations.
      const SPEECH_THRESHOLD = 80;  // 0–255 peak frequency amplitude
      const SPEECH_FRAMES_REQUIRED = 2; // at least 2 × 100 ms = 200 ms of real speech
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const audioStream = new MediaStream(stream.getAudioTracks());

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(audioStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      let recorderActive = true;
      let currentRecorder: MediaRecorder | null = null;

      const cycleRecorder = () => {
        if (!recorderActive) return;
        const rec = new MediaRecorder(audioStream, { mimeType });
        currentRecorder = rec;

        let speechFrames = 0;
        const vadInterval = setInterval(() => {
          analyser.getByteFrequencyData(freqData);
          if (Math.max(...freqData) > SPEECH_THRESHOLD) speechFrames++;
        }, 100);

        rec.ondataavailable = async (e) => {
          clearInterval(vadInterval);
          if (!recorderActive || speechFrames < SPEECH_FRAMES_REQUIRED || e.data.size < 500) return;
          const buffer = await e.data.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          conversationChannelRef.current?.push("audio_chunk", { audio: btoa(binary) });
        };

        rec.onstop = () => { if (recorderActive) cycleRecorder(); };
        rec.start();
        setTimeout(() => { if (rec.state === "recording") rec.stop(); }, 4000);
      };

      cycleRecorder();

      stopRecordingRef.current = () => {
        recorderActive = false;
        currentRecorder?.stop();
        audioCtx.close();
      };

      const onPresence = (state: PresenceState) => {
        const others = Object.keys(state).filter((id) => id !== currentUser.id);
        if (others.length > 0 && !peerPresent) {
          peerPresent = true;
          callIfReady();
        } else if (others.length === 0 && peerPresent) {
          resetPeer(stream);
        }
      };

      channel.on("presence_state", (state: PresenceState) => onPresence(state));

      channel.on(
        "presence_diff",
        (diff: { joins: PresenceState; leaves: PresenceState }) => {
          for (const id of Object.keys(diff.leaves)) {
            if (id !== currentUser.id && peerPresent) {
              resetPeer(stream);
            }
          }
          for (const id of Object.keys(diff.joins)) {
            if (id !== currentUser.id && !peerPresent) {
              peerPresent = true;
              callIfReady();
            }
          }
        },
      );

      channel.on("signal", async (payload: SignalPayload) => {
        if (payload.from === currentUser.id) return;
        const pc = pcRef.current;
        if (!pc) return;
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
      try { stopRecordingRef.current?.(); } catch {}
      try { conversationChannelRef.current?.leave(); } catch {}
      try { channelRef.current?.leave(); } catch {}
      try { socketRef.current?.disconnect(); } catch {}
      try { pcRef.current?.close(); } catch {}
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

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

  if (isDoctor) {
    return (
      <DoctorMeetingRoom
        meeting={meeting}
        patient={meeting.patient}
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        connState={connState}
        muted={muted}
        videoOff={videoOff}
        error={error}
        transcript={transcript}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onEndCall={endCall}
      />
    );
  }

  if (phase === "pre") {
    return <PatientPreMeetingView meeting={meeting} token={token} />;
  }

  if (phase === "post") {
    return <PatientPostMeetingView meeting={meeting} onBack={endCall} />;
  }

  return (
    <PatientMeetingRoom
      doctor={meeting.doctor}
      localVideoRef={localVideoRef}
      remoteVideoRef={remoteVideoRef}
      connState={connState}
      muted={muted}
      videoOff={videoOff}
      error={error}
      onToggleMute={toggleMute}
      onToggleVideo={toggleVideo}
      onEndCall={endCall}
    />
  );
}

function DoctorMeetingRoom({
  meeting,
  patient,
  localVideoRef,
  remoteVideoRef,
  connState,
  muted,
  videoOff,
  error,
  transcript,
  onToggleMute,
  onToggleVideo,
  onEndCall,
}: {
  meeting: Meeting;
  patient: User | null;
  localVideoRef: RefObject<HTMLVideoElement | null>;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  connState: ConnState;
  muted: boolean;
  videoOff: boolean;
  error: string | null;
  transcript: TranscriptEntry[];
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
}) {
  const [doneSuggestions, setDoneSuggestions] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"doctor" | "patient">("doctor");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (connState !== "connected") return;
    const timer = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [connState]);

  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const formatRecording = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const toggleSuggestion = (id: number) => {
    setDoneSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const patientName = patient
    ? `${patient.first_name} ${patient.last_name}`
    : "Patient";

  const isPatientMain = viewMode === "patient";

  return (
    <div className="flex flex-col h-screen bg-stone-100 text-stone-900">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-3 bg-white border-b border-stone-200 shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white shrink-0">
            <PersonIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-stone-900 truncate">{patientName}</p>
            <p className="text-xs text-stone-400 truncate">{meeting.title}</p>
          </div>
          <button className="flex items-center gap-0.5 text-orange-600 text-sm font-medium shrink-0 ml-2 hover:text-orange-700 transition-colors">
            Full chart
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="text-xs text-stone-400">HIPAA-compliant • Encrypted</span>
          <button
            onClick={onEndCall}
            className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-full text-sm font-semibold transition-colors"
          >
            End visit
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex flex-1 gap-4 p-4 overflow-hidden">
        {/* Left: Video + Transcript */}
        <div className="flex flex-col flex-1 gap-3 min-w-0 overflow-hidden">
          {/* Video area */}
          <div className="relative flex-1 rounded-xl overflow-hidden bg-[#2a1200] min-h-0">

            {/* Remote video (patient when in doctor view, self when in patient-perspective view) */}
            <video
              ref={isPatientMain ? localVideoRef : remoteVideoRef}
              autoPlay
              muted={isPatientMain}
              playsInline
              className="w-full h-full object-cover"
            />

            {/* Peer status badge */}
            {connState !== "connected" && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1 pointer-events-none">
                <span className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-pulse" />
                <span className="text-white/70 text-xs">
                  {connState === "connecting" ? "Connecting…" : `Waiting for ${patientName}…`}
                </span>
              </div>
            )}

            {/* Controls */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10">
              <button
                onClick={onToggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                  muted
                    ? "bg-orange-600 text-white"
                    : "bg-white/20 hover:bg-white/30 text-white"
                }`}
              >
                {muted ? (
                  <MicOffIcon className="w-5 h-5" />
                ) : (
                  <MicIcon className="w-5 h-5" />
                )}
              </button>
              <button
                onClick={onToggleVideo}
                aria-label={videoOff ? "Turn camera on" : "Turn camera off"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                  videoOff
                    ? "bg-orange-600 text-white"
                    : "bg-white/20 hover:bg-white/30 text-white"
                }`}
              >
                {videoOff ? (
                  <CameraOffIcon className="w-5 h-5" />
                ) : (
                  <CameraIcon className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* Doctor PiP (self view in bottom-right) */}
            <div className="absolute bottom-3 right-3 w-28 h-20 rounded-xl overflow-hidden bg-stone-800 border border-stone-600/50 z-10">
              <video
                ref={isPatientMain ? remoteVideoRef : localVideoRef}
                autoPlay
                muted={!isPatientMain}
                playsInline
                className={`w-full h-full object-cover${!isPatientMain ? " scale-x-[-1]" : ""}`}
              />
              {!isPatientMain && videoOff && (
                <div className="absolute inset-0 flex items-center justify-center bg-stone-800">
                  <CameraOffIcon className="w-5 h-5 text-stone-400" />
                </div>
              )}
            </div>
          </div>

          {/* Transcript */}
          <div
            ref={transcriptScrollRef}
            className="bg-white rounded-xl border border-stone-200 px-4 pt-3 pb-4 shrink-0 max-h-48 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold tracking-widest text-stone-500 uppercase">
                Live Transcript
              </span>
              <span className="text-xs text-stone-400">
                {transcript.length === 0 ? "Waiting…" : `${transcript.length} segment${transcript.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="space-y-1.5">
              {transcript.length === 0 ? (
                <p className="text-xs text-stone-400 italic">Transcription will appear here once the conversation starts.</p>
              ) : (
                transcript.slice(-8).map((entry, i) => (
                  <div key={i} className="flex gap-3 text-xs">
                    <span className="text-stone-400 font-mono w-10 shrink-0 pt-px">
                      {entry.time}
                    </span>
                    <span className={`w-14 shrink-0 font-semibold pt-px ${entry.speaker === "doctor" ? "text-orange-500" : "text-blue-500"}`}>
                      {entry.speaker === "doctor" ? "Médico" : "Paciente"}
                    </span>
                    <span className="text-stone-700 leading-relaxed">{entry.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: Patient Intake + AI Suggestions */}
        <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-hidden">
          {/* Patient intake */}
          {meeting.patient_intake ? (
            <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-3 shrink-0">
              <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">
                Patient intake
              </p>
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-xs text-stone-400 mb-0.5">Reason</p>
                  <p className="text-xs text-stone-700 leading-relaxed">{meeting.patient_intake.reason}</p>
                </div>
                {meeting.patient_intake.symptoms && (
                  <div>
                    <p className="text-xs text-stone-400 mb-0.5">Symptoms</p>
                    <p className="text-xs text-stone-700 leading-relaxed">{meeting.patient_intake.symptoms}</p>
                  </div>
                )}
                {meeting.patient_intake.notes && (
                  <div>
                    <p className="text-xs text-stone-400 mb-0.5">Notes</p>
                    <p className="text-xs text-stone-700 leading-relaxed">{meeting.patient_intake.notes}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-stone-50 rounded-xl border border-stone-200 px-4 py-3 shrink-0">
              <p className="text-xs text-stone-400 italic">Patient has not filled in pre-visit information yet.</p>
            </div>
          )}

          <div className="flex-1 bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-4 overflow-y-auto">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <SparkleIcon className="w-4 h-4 text-orange-500 shrink-0" />
                <h2 className="font-semibold text-stone-900 text-sm">AI Suggestions</h2>
              </div>
              <p className="text-xs text-stone-400 ml-6">Real-time guidance during your visit</p>
            </div>

            <div className="flex flex-col gap-3">
              {MOCK_SUGGESTIONS.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className={`p-3 rounded-xl border transition-opacity ${
                    doneSuggestions.has(suggestion.id)
                      ? "opacity-40 bg-stone-50 border-stone-100"
                      : "bg-stone-50 border-stone-100"
                  }`}
                >
                  <div className="flex items-start gap-2 mb-2.5">
                    <SparkleIcon className="w-3.5 h-3.5 text-orange-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-stone-700 leading-relaxed">{suggestion.text}</p>
                  </div>
                  <div className="flex gap-4 pl-5">
                    <button
                      onClick={() => toggleSuggestion(suggestion.id)}
                      className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 transition-colors"
                    >
                      <CheckIcon className="w-3 h-3" />
                      Done
                    </button>
                    <button className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 transition-colors">
                      <ChevronRightIcon className="w-3 h-3" />
                      More
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button className="w-full py-3 px-4 bg-white border border-stone-200 rounded-xl text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors text-left shrink-0">
            View draft SOAP note (73% complete)
          </button>
        </aside>
      </div>

      {error && (
        <div className="px-6 py-3 bg-red-900/40 border-t border-red-800 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

function PatientMeetingRoom({
  doctor,
  localVideoRef,
  remoteVideoRef,
  connState,
  muted,
  videoOff,
  error,
  onToggleMute,
  onToggleVideo,
  onEndCall,
}: {
  doctor: User | null;
  localVideoRef: RefObject<HTMLVideoElement | null>;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  connState: ConnState;
  muted: boolean;
  videoOff: boolean;
  error: string | null;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [viewMode, setViewMode] = useState<"doctor" | "patient">("patient");

  useEffect(() => {
    if (connState !== "connected") return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [connState]);

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const doctorName = doctor
    ? `Dr. ${doctor.first_name} ${doctor.last_name}`
    : "Doctor";

  const isConnected = connState === "connected";

  return (
    <div className="relative flex flex-col h-screen bg-[#2a1200] text-white overflow-hidden">
      {/* Remote (doctor) video fills the screen */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />


      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white text-sm">Cura</span>
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-green-400" : "bg-stone-400"
            }`}
          />
          <span className="text-white/70 text-xs">
            {isConnected ? `Connected with ${doctorName}` : "Waiting for doctor…"}
          </span>
        </div>
        {isConnected && (
          <span className="text-white/60 text-xs tabular-nums">
            {formatElapsed(elapsedSeconds)} elapsed
          </span>
        )}
      </div>

      {/* Transcription notice */}
      <div className="relative z-10 flex justify-center px-8 mt-2">
        <p className="text-white/50 text-xs italic text-center">
          This conversation is being securely transcribed to help your doctor focus on you.
        </p>
      </div>

      {/* Self-view PiP */}
      <div className="absolute bottom-24 right-4 z-10 w-28 h-20 rounded-xl overflow-hidden bg-stone-800 border border-stone-600/50">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover scale-x-[-1]"
        />
        {videoOff && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-800">
            <CameraOffIcon className="w-5 h-5 text-stone-400" />
          </div>
        )}
      </div>

      {/* Controls + view toggle */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
        <div className="flex items-center gap-3 bg-black/50 backdrop-blur-sm rounded-full px-4 py-3">
          <button
            onClick={onToggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              muted ? "bg-orange-600 text-white" : "bg-white/20 hover:bg-white/30 text-white"
            }`}
          >
            {muted ? <MicOffIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
          </button>
          <button
            onClick={onToggleVideo}
            aria-label={videoOff ? "Turn camera on" : "Turn camera off"}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              videoOff ? "bg-orange-600 text-white" : "bg-white/20 hover:bg-white/30 text-white"
            }`}
          >
            {videoOff ? <CameraOffIcon className="w-5 h-5" /> : <CameraIcon className="w-5 h-5" />}
          </button>

          <button
            onClick={onEndCall}
            aria-label="Leave"
            className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white transition-colors"
          >
            <PhoneOffIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="absolute bottom-0 left-0 right-0 z-20 px-6 py-3 bg-red-900/80 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

function PatientPreMeetingView({
  meeting,
  token,
}: {
  meeting: Meeting;
  token: string;
}) {
  const [timeUntil, setTimeUntil] = useState(() => getTimeUntilStart(meeting));
  const [reason, setReason] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(() => meeting.patient_intake !== null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setTimeUntil(getTimeUntilStart(meeting)), 1_000);
    return () => clearInterval(id);
  }, [meeting]);

  const start = new Date(`${meeting.date}T${meeting.time}`);
  const dateStr = start.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeStr = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const doctorName = meeting.doctor
    ? `Dr. ${meeting.doctor.first_name} ${meeting.doctor.last_name}`
    : "Your Doctor";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitMeetingIntake(
        meeting.id,
        { reason: reason.trim(), symptoms: symptoms.trim() || null, notes: notes.trim() || null },
        token,
      );
      setSubmitted(true);
    } catch {
      setSubmitError("Failed to save your information. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex flex-col h-screen bg-[#2a1200] text-white overflow-y-auto">
      {/* Top bar — matches PatientMeetingRoom */}
      <div className="relative z-10 flex items-center justify-between px-5 py-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white text-sm">Cura</span>
          <span className="w-2 h-2 rounded-full bg-orange-400" />
          <span className="text-white/70 text-xs">Appointment scheduled</span>
        </div>
        {timeUntil && (
          <span className="text-white/60 text-xs tabular-nums">in {timeUntil}</span>
        )}
      </div>

      <div className="flex flex-col items-center gap-6 max-w-lg w-full mx-auto px-6 pb-12 pt-6 text-center">
        {/* Doctor info */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-20 h-20 rounded-full bg-orange-600 flex items-center justify-center">
            <PersonIcon className="w-10 h-10 text-white" />
          </div>
          <div>
            <p className="font-semibold text-white text-lg">{doctorName}</p>
            <p className="text-white/50 text-sm mt-0.5">{meeting.title}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/50">
            <span>{dateStr}</span>
            <span className="text-white/20">·</span>
            <span className="text-orange-400 font-semibold">{timeStr}</span>
          </div>
        </div>

        {/* Form or confirmation */}
        {submitted ? (
          <div className="bg-black/40 backdrop-blur-sm rounded-2xl border border-white/10 px-8 py-8 w-full flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
              <CheckIcon className="w-6 h-6 text-green-400" />
            </div>
            <p className="font-semibold text-white">Information sent to your doctor</p>
            <p className="text-white/50 text-sm">
              This page will open automatically when your appointment begins.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-black/40 backdrop-blur-sm rounded-2xl border border-white/10 px-8 py-6 w-full text-left flex flex-col gap-5"
          >
            <div>
              <p className="text-xs font-semibold tracking-widest text-white/40 uppercase mb-1">
                Before your visit
              </p>
              <p className="text-white/60 text-sm">
                Help your doctor prepare by sharing a few details.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-white/80">
                Reason for visit <span className="text-orange-400">*</span>
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Annual check-up, follow-up on blood pressure"
                maxLength={500}
                required
                className="w-full px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/60 focus:border-transparent"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-white/80">Symptoms</label>
              <textarea
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="Describe any symptoms you're experiencing"
                maxLength={1000}
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/60 focus:border-transparent resize-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-white/80">Additional notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Medications, allergies, or anything else your doctor should know"
                maxLength={1000}
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/60 focus:border-transparent resize-none"
              />
            </div>

            {submitError && (
              <p className="text-sm text-red-400">{submitError}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !reason.trim()}
              className="w-full py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full text-sm font-semibold transition-colors"
            >
              {submitting ? "Saving…" : "Send to doctor"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PatientPostMeetingView({
  meeting,
  onBack,
}: {
  meeting: Meeting;
  onBack: () => void;
}) {
  const isCanceled = meeting.status === "canceled" || meeting.status === "rejected";
  const doctorName = meeting.doctor
    ? `Dr. ${meeting.doctor.first_name} ${meeting.doctor.last_name}`
    : "Your Doctor";
  const start = new Date(`${meeting.date}T${meeting.time}`);
  const dateStr = start.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="relative flex flex-col h-screen bg-[#2a1200] text-white items-center justify-center p-8">
      {/* Top bar — matches PatientMeetingRoom */}
      <div className="absolute top-0 left-0 right-0 flex items-center px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white text-sm">Cura</span>
          <span className={`w-2 h-2 rounded-full ${isCanceled ? "bg-stone-500" : "bg-green-400"}`} />
          <span className="text-white/70 text-xs">
            {isCanceled ? "Appointment canceled" : "Appointment ended"}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">
        <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
          isCanceled ? "bg-white/10" : "bg-white/10"
        }`}>
          {isCanceled ? (
            <PhoneOffIcon className="w-9 h-9 text-white/50" />
          ) : (
            <CheckIcon className="w-9 h-9 text-green-400" />
          )}
        </div>

        <div>
          <p className="text-xl font-semibold text-white">
            {isCanceled ? "Appointment canceled" : "Visit complete"}
          </p>
          <p className="text-white/50 text-sm mt-1">
            {isCanceled
              ? "This appointment was canceled."
              : `Your visit with ${doctorName} has ended.`}
          </p>
        </div>

        <div className="bg-black/40 backdrop-blur-sm rounded-2xl border border-white/10 px-8 py-5 w-full text-left">
          <p className="text-xs font-semibold tracking-widest text-white/40 uppercase mb-3">
            Details
          </p>
          <p className="text-white font-medium text-sm">{meeting.title}</p>
          <p className="text-white/40 text-xs mt-1">
            {dateStr} · {meeting.duration} min
          </p>
          {!isCanceled && (
            <p className="text-white/50 text-sm mt-2">with {doctorName}</p>
          )}
        </div>

        <button
          onClick={onBack}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-full text-sm font-semibold transition-colors"
        >
          Back to appointments
        </button>
      </div>
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

// ── Icons ────────────────────────────────────────────────────────────────────

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6" />
    </svg>
  );
}

function MicOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M18.89 13.23A7 7 0 0019 12M5 10a7 7 0 0012.66 4.13M15 9.34V4a3 3 0 00-5.68-1.33M9 9v3a3 3 0 005.12 2.12" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function CameraOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M9 9H1v10a2 2 0 002 2h12a2 2 0 001.73-1M16 5a2 2 0 00-2-2H6.73M23 7l-7 5 7 5V7z" />
    </svg>
  );
}

function ScreenShareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <polyline points="8 21 12 17 16 21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function StethoscopeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2v5a5 5 0 0010 0V2" />
      <path d="M12 12v4" />
      <circle cx="12" cy="18" r="2" />
      <path d="M6 2h2M16 2h2" />
    </svg>
  );
}

function PhoneOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 003.01 3.01l1.6-1.6a2 2 0 012.05-.45c1.13.4 2.35.62 3.61.62a2 2 0 012 2V21a2 2 0 01-2 2A18 18 0 013 5a2 2 0 012-2h3.5a2 2 0 012 2c0 1.26.22 2.48.62 3.61a2 2 0 01-.45 2.05l-1.6 1.6z" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

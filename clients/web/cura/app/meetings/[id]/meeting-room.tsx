'use client';

import {
  Camera,
  CameraOff,
  DoorOpen,
  Mic,
  MicOff,
  PhoneOff,
  Save,
  Send,
  Sparkles,
  Video,
  VideoOff,
} from 'lucide-react';
import { Channel, Socket } from 'phoenix';
import type {
  Diagnosis,
  Meeting,
  Prescription,
  Suggestion,
  TranscriptEntry,
  User,
  VisitSummary,
} from '@/lib/api/types';
import {
  MIN_CHUNK_BYTES,
  SPEECH_FRAMES_REQUIRED,
  isSpeechFrame,
} from '@/lib/audio/vad';
import { RefObject, useEffect, useRef, useState } from 'react';
import {
  completeMeeting,
  generateSoapDraft,
  getMeeting,
  getMeetingTranscript,
  saveVisitSummary,
  submitMeetingIntake,
  updateMeetingNotes,
} from '@/lib/api/meetings';

import Image from 'next/image';
import { Nav } from '@/components/nav';
import { PUBLIC_SOCKET_URL } from '@/lib/api/config';
import { getDoctorSlots } from '@/lib/api/availability';
import type { TimeSlot } from '@/lib/api/types';
import { getOnSitePhase } from '@/lib/meeting/phase';
import { useRouter } from 'next/navigation';

const PC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

type Props = {
  meeting: Meeting;
  currentUser: User;
  token: string;
  forceReport?: boolean;
};

type ConnState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'failed';

type SignalPayload = {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type PresenceState = Record<string, { metas: Array<Record<string, unknown>> }>;

type LiveTranscriptEntry = {
  time: string;
  text: string;
  speaker: 'doctor' | 'patient';
};

type MeetingPhase = 'pre' | 'active' | 'post';

function getMeetingPhase(meeting: Meeting): MeetingPhase {
  if (
    meeting.status === 'completed' ||
    meeting.status === 'canceled' ||
    meeting.status === 'rejected'
  ) {
    return 'post';
  }
  const now = Date.now();
  const start = new Date(`${meeting.date}T${meeting.time}`).getTime();
  const end = start + meeting.duration * 60 * 1000;
  if (now >= end) return 'post';
  return 'active';
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

export function MeetingRoom({
  meeting,
  currentUser,
  token,
  forceReport,
}: Props) {
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
  const [connState, setConnState] = useState<ConnState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<LiveTranscriptEntry[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [phase, setPhase] = useState<MeetingPhase>(() =>
    getMeetingPhase(meeting),
  );

  const isDoctor = currentUser.role === 'doctor';
  const otherParticipant = isDoctor ? meeting.patient : meeting.doctor;

  // Re-evaluate phase every 5 s so the view auto-transitions without a reload.
  // On-site meetings are phase-controlled by status only (see getOnSitePhase),
  // not by wall-clock, so we skip this poll for them.
  useEffect(() => {
    if (meeting.kind === 'on_site') return;
    if (phase === 'post') return;
    const id = setInterval(() => {
      const next = getMeetingPhase(meeting);
      if (next !== phase) setPhase(next);
    }, 5_000);
    return () => clearInterval(id);
  }, [phase, meeting]);

  // Deterministic caller: lower user id makes the offer, the other side
  // answers. No glare possible, no perfect-negotiation choreography needed.
  const isCaller = currentUser.id < (otherParticipant?.id ?? '￿');

  useEffect(() => {
    if (phase !== 'active') return;
    if (meeting.kind === 'on_site') return;
    let cancelled = false;
    let peerPresent = false;
    let didCall = false;
    let pendingCandidates: RTCIceCandidateInit[] = [];

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
        channelRef.current?.push('signal', { candidate: candidate.toJSON() });
      };

      pc.onconnectionstatechange = () => {
        if (cancelled) return;
        switch (pc.connectionState) {
          case 'connected':
            setConnState('connected');
            break;
          case 'connecting':
            setConnState('connecting');
            break;
          case 'failed':
            setConnState('failed');
            if (isCaller) pc.restartIce();
            break;
        }
      };

      pc.onnegotiationneeded = async () => {
        if (!isCaller || !peerPresent || cancelled) return;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channelRef.current?.push('signal', {
            description: pc.localDescription,
          });
        } catch (err) {
          console.error('onnegotiationneeded offer failed:', err);
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
          console.error('addIceCandidate (drain) failed:', err);
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
        channelRef.current?.push('signal', {
          description: pc.localDescription,
        });
      } catch (err) {
        console.error('createOffer failed:', err);
      }
    };

    const resetPeer = (stream: MediaStream) => {
      peerPresent = false;
      didCall = false;
      pendingCandidates = [];
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setConnState('waiting');
      makePc(stream);
    };

    const start = async () => {
      setConnState('waiting');

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
            ? `Não foi possível aceder à câmara/microfone: ${err.message}`
            : 'Não foi possível aceder à câmara/microfone.',
        );
        setConnState('failed');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      makePc(stream);

      const socket = new Socket(`${PUBLIC_SOCKET_URL}/socket`, {
        params: { token },
      });
      socket.connect();
      socketRef.current = socket;

      const channel = socket.channel(`room:${meeting.id}`);
      channelRef.current = channel;

      const convChannel = socket.channel(`conversation:${meeting.id}`);
      conversationChannelRef.current = convChannel;

      convChannel.on(
        'transcript_update',
        ({
          text,
          speaker,
          timestamp,
        }: {
          text: string;
          speaker: 'doctor' | 'patient';
          timestamp: string;
        }) => {
          if (cancelled) return;
          const date = new Date(timestamp);
          const time = date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          setTranscript((prev) => [...prev, { time, text, speaker }]);
        },
      );

      // Append-only running checklist. Backend already dedupes against prior
      // items before broadcasting, so we just concatenate in arrival order.
      convChannel.on(
        'suggestions_update',
        ({ suggestions: incoming }: { suggestions: Suggestion[] }) => {
          if (cancelled || !Array.isArray(incoming) || incoming.length === 0)
            return;
          setSuggestions((prev) => {
            const seen = new Set(prev.map((s) => s.id));
            const fresh = incoming.filter((s) => !seen.has(s.id));
            return fresh.length === 0 ? prev : [...prev, ...fresh];
          });
        },
      );

      convChannel.join();

      // Audio capture: record 15-second chunks and send to Whisper via conversation channel.
      // A VAD (voice activity detection) analyser gates each chunk — silent windows are
      // dropped before they reach the network, preventing Whisper hallucinations.
      const SPEECH_THRESHOLD = 80; // 0–255 peak frequency amplitude
      const SPEECH_FRAMES_REQUIRED = 2; // at least 2 × 100 ms = 200 ms of real speech
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
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
          if (
            !recorderActive ||
            speechFrames < SPEECH_FRAMES_REQUIRED ||
            e.data.size < 500
          )
            return;
          const buffer = await e.data.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++)
            binary += String.fromCharCode(bytes[i]);
          conversationChannelRef.current?.push('audio_chunk', {
            audio: btoa(binary),
          });
        };

        rec.onstop = () => {
          if (recorderActive) cycleRecorder();
        };
        rec.start();
        setTimeout(() => {
          if (rec.state === 'recording') rec.stop();
        }, 4000);
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

      channel.on('presence_state', (state: PresenceState) => onPresence(state));

      channel.on(
        'presence_diff',
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

      channel.on('signal', async (payload: SignalPayload) => {
        if (payload.from === currentUser.id) return;
        const pc = pcRef.current;
        if (!pc) return;
        try {
          if (payload.description) {
            await pc.setRemoteDescription(payload.description);
            if (payload.description.type === 'offer') {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              channel.push('signal', { description: pc.localDescription });
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
          console.error('signal handling failed:', err);
        }
      });

      channel.join().receive('error', ({ reason }: { reason: string }) => {
        if (cancelled) return;
        setError(`Não foi possível entrar na sala: ${reason}`);
        setConnState('failed');
      });
    };

    start();

    return () => {
      cancelled = true;
      try {
        stopRecordingRef.current?.();
      } catch {}
      try {
        conversationChannelRef.current?.leave();
      } catch {}
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

  const endCall = () => router.push('/meetings');

  // On-site visits skip the WebRTC + remote pipeline and only stream audio.
  // Patients aren't expected to "join" — they're physically next to the doctor.
  if (meeting.kind === 'on_site') {
    if (!isDoctor) {
      return (
        <OnSiteNotForPatient
          onBack={endCall}
          currentUser={currentUser}
          token={token}
        />
      );
    }
    const onSitePhase = forceReport ? 'post' : getOnSitePhase(meeting);
    if (onSitePhase === 'post') {
      return (
        <DoctorPostMeetingView
          meeting={meeting}
          token={token}
          onBack={endCall}
          currentUser={currentUser}
        />
      );
    }
    return (
      <OnSiteMeetingRoom
        meeting={meeting}
        token={token}
        onLeave={endCall}
        currentUser={currentUser}
      />
    );
  }

  if (isDoctor) {
    if (phase === 'post') {
      return (
        <DoctorPostMeetingView
          meeting={meeting}
          token={token}
          onBack={endCall}
          currentUser={currentUser}
        />
      );
    }
    return (
      <DoctorMeetingRoom
        meeting={meeting}
        patient={meeting.patient}
        token={token}
        currentUser={currentUser}
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        connState={connState}
        muted={muted}
        videoOff={videoOff}
        error={error}
        suggestions={suggestions}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onEndCall={endCall}
      />
    );
  }

  if (phase === 'pre') {
    return (
      <PatientPreMeetingView
        meeting={meeting}
        token={token}
        currentUser={currentUser}
      />
    );
  }

  if (phase === 'post') {
    return (
      <PatientPostMeetingView
        meeting={meeting}
        token={token}
        onBack={endCall}
        currentUser={currentUser}
      />
    );
  }

  return (
    <PatientMeetingRoom
      doctor={meeting.doctor}
      token={token}
      currentUser={currentUser}
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

type LiveTranscriptItem = {
  id: string;
  speaker: 'doctor' | 'patient';
  text: string;
  time: string;
};

const BAR_COUNT = 28;

function AudioWave({ analyserRef, muted }: { analyserRef: React.RefObject<AnalyserNode | null>; muted: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId: number;

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const analyser = analyserRef.current;
      const data = new Uint8Array(BAR_COUNT);
      if (analyser && !muted) {
        analyser.getByteFrequencyData(data);
      }

      const gap = 3;
      const barW = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;

      for (let i = 0; i < BAR_COUNT; i++) {
        const level = muted ? 0 : data[i] / 255;
        const barH = Math.max(3, level * height);
        const x = i * (barW + gap);
        const y = (height - barH) / 2;
        const alpha = 0.25 + level * 0.75;
        ctx.fillStyle = `rgba(181,71,27,${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, [analyserRef, muted]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={56}
      className="w-full h-14"
    />
  );
}

/**
 * On-site visit room (doctor in the same physical room as the patient).
 *
 * No WebRTC, no video, no `room:` signaling channel — just the audio capture
 * loop feeding Whisper through the conversation channel, plus the live
 * transcript and clinical-hint streams that drive the SOAP-note prep.
 */
function OnSiteMeetingRoom({
  meeting,
  token,
  onLeave,
  currentUser,
}: {
  meeting: Meeting;
  token: string;
  onLeave: () => void;
  currentUser: User;
}) {
  const router = useRouter();
  const conversationChannelRef = useRef<Channel | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<LiveTranscriptItem[]>([]);
  // On-site visits don't share state with the parent (the parent's effect
  // early-returns for kind: "on_site"), so suggestions are tracked locally.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [doneSuggestions, setDoneSuggestions] = useState<Set<string>>(
    new Set(),
  );
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      let stream: MediaStream;
      try {
        // Audio-only — no camera prompt for on-site visits.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? `Não foi possível aceder ao microfone: ${err.message}`
            : 'Não foi possível aceder ao microfone.',
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;

      const socket = new Socket(`${PUBLIC_SOCKET_URL}/socket`, {
        params: { token },
      });
      socket.connect();
      socketRef.current = socket;

      const convChannel = socket.channel(`conversation:${meeting.id}`);
      conversationChannelRef.current = convChannel;

      convChannel.on(
        'transcript_update',
        ({
          text,
          speaker,
          timestamp,
        }: {
          text: string;
          speaker: 'doctor' | 'patient';
          timestamp: string;
        }) => {
          if (cancelled) return;
          const time = new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          setTranscript((prev) => [
            ...prev,
            { id: `${prev.length}-${timestamp}`, speaker, text, time },
          ]);
        },
      );

      // Live AI clinical hints. Backend dedupes against prior items before
      // broadcasting; we still guard locally in case the user rejoins and the
      // backend replays the buffer.
      convChannel.on(
        'suggestions_update',
        ({ suggestions: incoming }: { suggestions: Suggestion[] }) => {
          if (cancelled || !Array.isArray(incoming) || incoming.length === 0)
            return;
          setSuggestions((prev) => {
            const seen = new Set(prev.map((s) => s.id));
            const fresh = incoming.filter((s) => !seen.has(s.id));
            return fresh.length === 0 ? prev : [...prev, ...fresh];
          });
        },
      );

      convChannel.join();

      // Audio capture: same VAD-gated chunk loop as remote, but the only
      // consumer is the conversation channel — there is no peer connection.
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const audioStream = new MediaStream(stream.getAudioTracks());

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(audioStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
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
          if (isSpeechFrame(freqData)) speechFrames++;
        }, 100);

        rec.ondataavailable = async (e) => {
          clearInterval(vadInterval);
          if (
            !recorderActive ||
            speechFrames < SPEECH_FRAMES_REQUIRED ||
            e.data.size < MIN_CHUNK_BYTES
          )
            return;
          const buffer = await e.data.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++)
            binary += String.fromCharCode(bytes[i]);
          conversationChannelRef.current?.push('audio_chunk', {
            audio: btoa(binary),
          });
        };

        rec.onstop = () => {
          if (recorderActive) cycleRecorder();
        };
        rec.start();
        setTimeout(() => {
          if (rec.state === 'recording') rec.stop();
        }, 4000);
      };

      cycleRecorder();

      stopRecordingRef.current = () => {
        recorderActive = false;
        currentRecorder?.stop();
        audioCtx.close();
      };
    };

    start();

    return () => {
      cancelled = true;
      try {
        stopRecordingRef.current?.();
      } catch {}
      try {
        conversationChannelRef.current?.leave();
      } catch {}
      try {
        socketRef.current?.disconnect();
      } catch {}
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      analyserRef.current = null;
    };
  }, [meeting.id, token]);

  const toggleMute = () => {
    const audio = localStreamRef.current?.getAudioTracks()[0];
    if (!audio) return;
    audio.enabled = !audio.enabled;
    setMuted(!audio.enabled);
  };

  const toggleSuggestion = (id: string) => {
    setDoneSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEnd = async () => {
    setEnding(true);
    try {
      await completeMeeting(meeting.id, token);
      // Trigger a route refresh so the post-visit SOAP editor mounts with
      // the now-completed meeting.
      router.refresh();
    } catch {
      // Even if the API call fails, let the doctor leave — they can retry
      // the SOAP submit later from the meetings list.
      onLeave();
    } finally {
      setEnding(false);
    }
  };

  const patientName = meeting.patient
    ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
    : 'Patient';

  return (
    <div className="flex flex-col h-screen bg-stone-50 text-stone-900">
      <Nav
        user={currentUser}
        token={token}
        wide
        center={
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm text-black/70 truncate">{patientName}</span>
            <span className="w-1 h-1 rounded-full bg-black/20 shrink-0" />
            <span className="text-xs text-black/40 shrink-0">Consulta presencial</span>
          </div>
        }
        mobileCenter={
          <div className="flex items-center gap-3">
            <button
              onClick={toggleMute}
              title={muted ? 'Ativar microfone' : 'Silenciar'}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                muted ? 'bg-[#b5471b] text-white' : 'bg-black/[0.06] text-stone-600 hover:bg-black/10'
              }`}
            >
              {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={handleEnd}
              disabled={ending}
              title="Terminar consulta"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-[#b5471b] text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* Desktop-only spacer + header row */}
      <div className="hidden md:block h-26 shrink-0" />
      <div className="hidden md:flex items-center justify-between px-6 pb-3 shrink-0">
        <div>
          <p className="font-semibold text-stone-900 text-sm">{patientName}</p>
          <p className="text-xs text-stone-400">{meeting.title} · Consulta presencial</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={toggleMute}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              muted ? 'bg-[#b5471b] text-white hover:opacity-90' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
            }`}
          >
            {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            {muted ? 'Microfone em silêncio' : 'Microfone ativo'}
          </button>
          <button
            onClick={handleEnd}
            disabled={ending}
            className="px-5 py-2 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-1.5"
          >
            <PhoneOff className="w-4 h-4" />
            {ending ? 'A terminar…' : 'Terminar consulta'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-4 px-4 pb-4 md:overflow-hidden overflow-y-auto pb-36 md:pb-4">
        {/* Live transcript — desktop only */}
        <div className="hidden md:flex flex-1 flex-col bg-white rounded-xl border border-stone-200 overflow-hidden min-w-0">
          <div className="px-5 pt-4 pb-3 border-b border-stone-100 shrink-0">
            <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">Transcrição ao vivo</p>
            <p className="text-xs text-stone-400 mt-0.5">
              {transcript.length === 0 ? 'A aguardar fala…' : `${transcript.length} ${transcript.length === 1 ? 'segmento' : 'segmentos'}`}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {error && <p className="text-sm text-[#b5471b]">{error}</p>}
            {transcript.length === 0 && !error && (
              <p className="text-sm text-stone-400 italic">A transcrição aparecerá aqui à medida que a consulta decorre.</p>
            )}
            {transcript.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-stone-400 w-10 shrink-0">{entry.time}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${entry.speaker === 'doctor' ? 'text-orange-500' : 'text-blue-500'}`}>
                    {entry.speaker === 'doctor' ? 'MD' : 'Pt'}
                  </span>
                </div>
                <p className="text-sm text-stone-800 leading-relaxed pl-12">{entry.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* AI suggestions — full width on mobile */}
        <div className="w-full md:w-80 shrink-0 flex flex-col bg-white rounded-xl border border-stone-200 md:overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-stone-100 shrink-0">
            <div className="flex items-center gap-2">
              <SparkleIcon className="w-4 h-4 text-orange-500 shrink-0" />
              <p className="text-sm font-semibold text-stone-900">Sugestões Clínicas</p>
            </div>
            <p className="text-xs text-stone-400 mt-0.5 ml-6">Sugestões em tempo real à medida que a consulta decorre</p>
          </div>
          {/* Audio visualizer — mobile only */}
          <div className="md:hidden px-4 pt-3 pb-1 border-b border-stone-100">
            {error
              ? <p className="text-xs text-[#b5471b] py-2">{error}</p>
              : <AudioWave analyserRef={analyserRef} muted={muted} />
            }
          </div>
          <div className="flex-1 md:overflow-y-auto px-5 py-4 space-y-3">
            {suggestions.length === 0 ? (
              <p className="text-xs text-stone-400 italic">As sugestões aparecerão à medida que a conversa progride.</p>
            ) : (
              suggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  done={doneSuggestions.has(suggestion.id)}
                  onToggle={() => toggleSuggestion(suggestion.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OnSiteNotForPatient({
  onBack,
  currentUser,
  token,
}: {
  onBack: () => void;
  currentUser: User;
  token: string;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 text-stone-900 px-6 text-center gap-4">
      <Nav user={currentUser} token={token} />
      <p className="text-xl font-semibold">Consulta presencial</p>
      <p className="text-sm text-stone-500 max-w-md">
        Esta é uma consulta presencial — o seu médico está a registá-la em
        pessoa. Não há nada a fazer aqui.
      </p>
      <button
        onClick={onBack}
        className="px-5 py-2 rounded-full bg-[#b5471b] text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Voltar às consultas
      </button>
    </div>
  );
}

function DoctorPostMeetingView({
  meeting,
  token,
  onBack,
  currentUser,
}: {
  meeting: Meeting;
  token: string;
  onBack: () => void;
  currentUser: User;
}) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(true);

  const [bpInput, setBpInput] = useState(meeting.soap_note?.vitals?.blood_pressure ?? "");
  const [hrInput, setHrInput] = useState(meeting.soap_note?.vitals?.heart_rate ?? "");
  const [tempInput, setTempInput] = useState(meeting.soap_note?.vitals?.temperature ?? "");
  const [weightInput, setWeightInput] = useState(meeting.soap_note?.vitals?.weight ?? "");
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>(meeting.soap_note?.diagnoses ?? []);
  const [clinicalAssessment, setClinicalAssessment] = useState(meeting.soap_note?.clinical_assessment ?? "");
  const [treatmentPlan, setTreatmentPlan] = useState<string[]>(meeting.soap_note?.treatment_plan ?? []);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>(meeting.soap_note?.prescriptions ?? []);
  const [labOrders, setLabOrders] = useState<string[]>(meeting.soap_note?.lab_orders ?? []);
  const [followUp, setFollowUp] = useState<{ date: string; time: string } | null>(meeting.soap_note?.follow_up_appointment ?? null);
  const [followUpDate, setFollowUpDate] = useState(meeting.soap_note?.follow_up_appointment?.date ?? "");
  const [followUpSlots, setFollowUpSlots] = useState<TimeSlot[]>([]);
  const [followUpSlotsLoading, setFollowUpSlotsLoading] = useState(false);
  const [whenToSeekCare, setWhenToSeekCare] = useState<string[]>(meeting.soap_note?.when_to_seek_care ?? []);

  const [submitted, setSubmitted] = useState(meeting.soap_note_submitted);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getMeetingTranscript(meeting.id, token)
      .then(({ transcript: entries }) => setTranscript(entries))
      .catch(() => {})
      .finally(() => setTranscriptLoading(false));
  }, [meeting.id, token]);

  const updateDiagnosis = (i: number, updates: Partial<Diagnosis>) =>
    setDiagnoses((prev) =>
      prev.map((d, idx) => (idx === i ? { ...d, ...updates } : d)),
    );
  const addDiagnosis = () =>
    setDiagnoses((prev) => [
      ...prev,
      { condition: '', icd_code: null, type: 'primary' },
    ]);
  const removeDiagnosis = (i: number) =>
    setDiagnoses((prev) => prev.filter((_, idx) => idx !== i));

  const updateTreatmentItem = (i: number, v: string) =>
    setTreatmentPlan((prev) => prev.map((t, idx) => (idx === i ? v : t)));
  const addTreatmentItem = () => setTreatmentPlan((prev) => [...prev, '']);
  const removeTreatmentItem = (i: number) =>
    setTreatmentPlan((prev) => prev.filter((_, idx) => idx !== i));

  const updatePrescription = (i: number, updates: Partial<Prescription>) =>
    setPrescriptions((prev) =>
      prev.map((rx, idx) => (idx === i ? { ...rx, ...updates } : rx)),
    );
  const addPrescription = () =>
    setPrescriptions((prev) => [
      ...prev,
      {
        name: '',
        dosage: null,
        quantity: null,
        refills: null,
        instructions: null,
      },
    ]);
  const removePrescription = (i: number) =>
    setPrescriptions((prev) => prev.filter((_, idx) => idx !== i));

  const updateLabOrder = (i: number, v: string) =>
    setLabOrders((prev) => prev.map((l, idx) => (idx === i ? v : l)));
  const addLabOrder = () => setLabOrders((prev) => [...prev, '']);
  const removeLabOrder = (i: number) =>
    setLabOrders((prev) => prev.filter((_, idx) => idx !== i));

  const updateWhenToSeekCare = (i: number, v: string) =>
    setWhenToSeekCare((prev) => prev.map((w, idx) => (idx === i ? v : w)));
  const addWhenToSeekCare = () => setWhenToSeekCare((prev) => [...prev, '']);
  const removeWhenToSeekCare = (i: number) =>
    setWhenToSeekCare((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = async (doSubmit: boolean) => {
    setSaving(true);
    setSaveError(null);
    try {
      const note: VisitSummary = {
        vitals:
          bpInput || hrInput || tempInput || weightInput
            ? {
                blood_pressure: bpInput.trim() || null,
                heart_rate: hrInput.trim() || null,
                temperature: tempInput.trim() || null,
                weight: weightInput.trim() || null,
              }
            : null,
        diagnoses: diagnoses.filter((d) => d.condition.trim()),
        clinical_assessment: clinicalAssessment.trim() || null,
        treatment_plan: treatmentPlan.filter(t => t.trim()),
        prescriptions: prescriptions.filter(p => p.name.trim()),
        lab_orders: labOrders.filter(l => l.trim()),
        follow_up_appointment: followUp ?? null,
        when_to_seek_care: whenToSeekCare.filter(w => w.trim()),
      };
      await saveVisitSummary(meeting.id, note, doSubmit, token);
      if (doSubmit) setSubmitted(true);
      setLastSaved(new Date());
    } catch {
      setSaveError('Falha ao guardar. Por favor, tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setSaveError(null);
    try {
      const { soap_note: note } = await generateSoapDraft(meeting.id, token);
      if (note.vitals) {
        setBpInput(note.vitals.blood_pressure ?? '');
        setHrInput(note.vitals.heart_rate ?? '');
        setTempInput(note.vitals.temperature ?? '');
        setWeightInput(note.vitals.weight ?? '');
      }
      if (note.diagnoses?.length) setDiagnoses(note.diagnoses);
      if (note.clinical_assessment)
        setClinicalAssessment(note.clinical_assessment);
      if (note.treatment_plan?.length) setTreatmentPlan(note.treatment_plan);
      if (note.prescriptions?.length) setPrescriptions(note.prescriptions);
      if (note.lab_orders?.length) setLabOrders(note.lab_orders);
      const rawNote = note as unknown as Record<string, unknown>;
      const recommendation = rawNote.follow_up_recommendation as string | null | undefined;
      if (recommendation) {
        const minDate = new Date();
        minDate.setDate(minDate.getDate() + 30);
        const recDate = new Date(recommendation + 'T12:00:00');
        const startDate = recDate > minDate ? recDate : minDate;
        const startDateStr = startDate.toISOString().split('T')[0];
        setFollowUpDate(startDateStr);
        setFollowUpSlotsLoading(true);
        try {
          // Try up to 7 days from the recommended date to find an available slot
          let found = false;
          for (let offset = 0; offset < 7 && !found; offset++) {
            const d = new Date(startDateStr + 'T12:00:00');
            d.setDate(d.getDate() + offset);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const { slots } = await getDoctorSlots(meeting.doctor!.id, dateStr, token);
            if (slots.length > 0) {
              setFollowUpDate(dateStr);
              setFollowUpSlots(slots);
              setFollowUp({ date: dateStr, time: slots[0].time });
              found = true;
            }
          }
        } catch {
          // leave picker empty
        } finally {
          setFollowUpSlotsLoading(false);
        }
      }
      if (note.when_to_seek_care?.length) setWhenToSeekCare(note.when_to_seek_care);
    } catch {
      setSaveError(
        'Não foi possível gerar o rascunho. Verifique se existe uma transcrição disponível.',
      );
    } finally {
      setGenerating(false);
    }
  };

  const patientName = meeting.patient
    ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
    : 'Patient';

  const profile = meeting.patient?.patient_profile ?? null;

  const start = new Date(`${meeting.date}T${meeting.time}`);
  const dateStr = start.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const inputCls =
    'w-full px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-sm text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-orange-400/50 focus:border-transparent disabled:opacity-60 disabled:cursor-default';

  return (
    <div className="flex flex-col h-screen bg-stone-100 text-stone-900">
      <Nav
        user={currentUser}
        token={token}
        wide
        center={
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm text-black/70 truncate">
              {patientName}
            </span>
            <span className="w-1 h-1 rounded-full bg-black/20 shrink-0" />
            <span className="text-xs text-black/40 shrink-0">{dateStr}</span>
          </div>
        }
        mobileCenter={!submitted ? (
          <div className="flex items-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={generating || saving}
              title="Gerar rascunho"
              className={`w-9 h-9 rounded-full flex items-center justify-center border border-orange-300 text-orange-600 disabled:opacity-40 transition-colors ${generating ? 'cura-ai-shimmer' : 'hover:bg-orange-50'}`}
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={saving || generating}
              title="Guardar rascunho"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-black/[0.06] text-stone-600 disabled:opacity-40 hover:bg-black/10 transition-colors"
            >
              <Save className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving || generating}
              title="Submeter e finalizar"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-[#b5471b] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        ) : undefined}
      />
      <div className="hidden md:block h-26 shrink-0" />

      <div className="flex flex-col md:flex-row flex-1 gap-4 p-4 pb-48 md:pb-4 overflow-y-auto md:overflow-hidden">
        {/* Back link — mobile only */}
        <button
          onClick={onBack}
          className="md:hidden self-start flex items-center gap-1.5 text-sm text-black/40 hover:text-black/70 transition-colors mb-1"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
          Voltar às consultas
        </button>

        {/* Left: Transcript — hidden on mobile */}
        <div className="hidden md:flex w-64 shrink-0 flex-col bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-stone-100 shrink-0">
            <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">
              Transcrição da Consulta
            </p>
            {!transcriptLoading && (
              <p className="text-xs text-stone-400 mt-0.5">
                {transcript.length === 0
                  ? 'Sem entradas registadas'
                  : `${transcript.length} ${transcript.length === 1 ? 'segmento' : 'segmentos'}`}
              </p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {transcriptLoading ? (
              <p className="text-xs text-stone-400 italic">
                A carregar transcrição…
              </p>
            ) : transcript.length === 0 ? (
              <p className="text-xs text-stone-400 italic">
                Sem entradas de transcrição para esta consulta.
              </p>
            ) : (
              transcript.map((entry) => {
                const ts = new Date(entry.timestamp);
                const time = ts.toLocaleTimeString('pt-PT', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <div key={entry.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-stone-400 w-10 shrink-0">
                        {time}
                      </span>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide ${entry.speaker === 'doctor' ? 'text-orange-500' : 'text-blue-500'}`}
                      >
                        {entry.speaker === 'doctor' ? 'MD' : 'Pt'}
                      </span>
                    </div>
                    <p className="text-xs text-stone-700 leading-relaxed pl-12">
                      {entry.text}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center: Visit Summary form */}
        <div className="flex-1 flex flex-col min-w-0 md:overflow-hidden">
          <div
            className={`bg-white rounded-xl border border-stone-200 flex flex-col md:flex-1 md:overflow-hidden ${generating ? 'cura-ai-pending' : ''}`}
          >
            <div className="px-6 pt-5 pb-4 border-b border-stone-100 shrink-0 relative">
              <div className="flex items-center gap-2">
                <StethoscopeIcon className="w-4 h-4 text-orange-500 shrink-0" />
                <h2 className="font-semibold text-stone-900">Resumo</h2>
              </div>
              {submitted && (
                <p className="text-xs text-stone-400 mt-1 ml-6">
                  Este resumo foi submetido e é só de leitura.
                </p>
              )}
              {generating && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 border border-orange-100 cura-ai-shimmer">
                  <Sparkles className="w-3.5 h-3.5 text-orange-600 cura-ai-pulse shrink-0" />
                  <p className="text-xs font-medium text-orange-900">
                    Drafting visit summary from the transcript and patient
                    context…
                  </p>
                </div>
              )}
            </div>

            <div
              className={`px-6 py-5 space-y-6 transition-opacity duration-300 md:flex-1 md:overflow-y-auto ${generating ? 'opacity-60' : 'opacity-100'}`}
            >
              {/* Vitals */}
              <FormSection
                icon={<HeartPulseIcon className="w-4 h-4" />}
                title="Sinais Vitais"
              >
                <div className="grid grid-cols-2 gap-3">
                  <FormInput
                    label="Pressão Arterial"
                    value={bpInput}
                    onChange={setBpInput}
                    placeholder="ex. 120/80 mmHg"
                    disabled={submitted}
                  />
                  <FormInput
                    label="Frequência Cardíaca"
                    value={hrInput}
                    onChange={setHrInput}
                    placeholder="ex. 72 bpm"
                    disabled={submitted}
                  />
                  <FormInput
                    label="Temperatura"
                    value={tempInput}
                    onChange={setTempInput}
                    placeholder="ex. 37°C"
                    disabled={submitted}
                  />
                  <FormInput
                    label="Peso"
                    value={weightInput}
                    onChange={setWeightInput}
                    placeholder="ex. 75 kg"
                    disabled={submitted}
                  />
                </div>
              </FormSection>

              {/* Diagnoses */}
              <FormSection
                icon={<StethoscopeIcon className="w-4 h-4" />}
                title="Diagnósticos"
              >
                <div className="space-y-2">
                  {diagnoses.map((d, i) => (
                    <div
                      key={i}
                      className="border border-stone-200 rounded-xl p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-stone-400">
                          Diagnosis {i + 1}
                        </span>
                        {!submitted && (
                          <button
                            onClick={() => removeDiagnosis(i)}
                            className="text-stone-400 hover:text-red-500 transition-colors"
                            aria-label="Remove diagnosis"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {/* `min-w-0` lets flex shrink/grow this input below its
                          intrinsic 20-char size, so long diagnosis names
                          ("Tiroidite autoimune de Hashimoto") still display. */}
                      <input
                        value={d.condition}
                        onChange={(e) =>
                          updateDiagnosis(i, { condition: e.target.value })
                        }
                        disabled={submitted}
                        placeholder="Nome da condição"
                        className={`flex-1 ${inputCls}`}
                      />
                      <input
                        value={d.icd_code ?? ''}
                        onChange={(e) =>
                          updateDiagnosis(i, {
                            icd_code: e.target.value || null,
                          })
                        }
                        disabled={submitted}
                        placeholder="ICD-10"
                        className={`w-24 ${inputCls}`}
                      />
                      <select
                        value={d.type}
                        onChange={(e) =>
                          updateDiagnosis(i, {
                            type: e.target.value as 'primary' | 'secondary',
                          })
                        }
                        disabled={submitted}
                        className={`w-28 ${inputCls}`}
                      >
                        <option value="primary">Principal</option>
                        <option value="secondary">Secundário</option>
                      </select>
                      {!submitted && (
                        <button
                          onClick={() => removeDiagnosis(i)}
                          className="text-stone-400 hover:text-red-500 transition-colors shrink-0"
                        >
                          <XIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!submitted && (
                    <button
                      onClick={addDiagnosis}
                      className="flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 font-medium transition-colors"
                    >
                      <PlusIcon className="w-4 h-4" /> Adicionar diagnóstico
                    </button>
                  )}
                </div>
              </FormSection>

              {/* Clinical Assessment */}
              <FormSection
                icon={<ClipboardIcon className="w-4 h-4" />}
                title="Avaliação Clínica"
              >
                <textarea
                  value={clinicalAssessment}
                  onChange={(e) => setClinicalAssessment(e.target.value)}
                  disabled={submitted}
                  rows={3}
                  placeholder="Insira notas de avaliação clínica…"
                  className="w-full px-3 py-2.5 rounded-xl bg-stone-50 border border-stone-200 text-sm text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-orange-400/50 focus:border-transparent resize-none disabled:opacity-60 disabled:cursor-default"
                />
              </FormSection>

              {/* Treatment Plan */}
              <FormSection
                icon={<ClipboardCheckIcon className="w-4 h-4" />}
                title="Plano de Tratamento"
              >
                <div className="space-y-2">
                  {treatmentPlan.map((item, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        value={item}
                        onChange={(e) => updateTreatmentItem(i, e.target.value)}
                        disabled={submitted}
                        placeholder="Item do tratamento…"
                        className={`flex-1 ${inputCls}`}
                      />
                      {!submitted && (
                        <button
                          onClick={() => removeTreatmentItem(i)}
                          className="text-stone-400 hover:text-red-500 transition-colors shrink-0"
                        >
                          <XIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!submitted && (
                    <button
                      onClick={addTreatmentItem}
                      className="flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 font-medium transition-colors"
                    >
                      <PlusIcon className="w-4 h-4" /> Adicionar item
                    </button>
                  )}
                </div>
              </FormSection>

              {/* Prescriptions */}
              <FormSection
                icon={<PillIcon className="w-4 h-4" />}
                title="Prescrições"
              >
                <div className="space-y-3">
                  {prescriptions.map((rx, i) => (
                    <div
                      key={i}
                      className="border border-stone-200 rounded-xl p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-stone-400">
                          Prescrição {i + 1}
                        </span>
                        {!submitted && (
                          <button
                            onClick={() => removePrescription(i)}
                            className="text-stone-400 hover:text-red-500 transition-colors"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <input
                        value={rx.name}
                        onChange={(e) =>
                          updatePrescription(i, { name: e.target.value })
                        }
                        disabled={submitted}
                        placeholder="Nome do medicamento"
                        className={inputCls}
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          value={rx.dosage ?? ''}
                          onChange={(e) =>
                            updatePrescription(i, {
                              dosage: e.target.value || null,
                            })
                          }
                          disabled={submitted}
                          placeholder="Dosagem"
                          className={inputCls}
                        />
                        <input
                          value={rx.quantity ?? ''}
                          onChange={(e) =>
                            updatePrescription(i, {
                              quantity: e.target.value || null,
                            })
                          }
                          disabled={submitted}
                          placeholder="Quantidade"
                          className={inputCls}
                        />
                        <input
                          value={rx.refills ?? ''}
                          onChange={(e) =>
                            updatePrescription(i, {
                              refills: e.target.value || null,
                            })
                          }
                          disabled={submitted}
                          placeholder="Recargas"
                          className={inputCls}
                        />
                      </div>
                      <textarea
                        value={rx.instructions ?? ''}
                        onChange={(e) =>
                          updatePrescription(i, {
                            instructions: e.target.value || null,
                          })
                        }
                        disabled={submitted}
                        rows={2}
                        placeholder="Instruções de dosagem…"
                        className="w-full px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-sm text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-orange-400/50 focus:border-transparent resize-none disabled:opacity-60 disabled:cursor-default"
                      />
                    </div>
                  ))}
                  {!submitted && (
                    <button
                      onClick={addPrescription}
                      className="flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 font-medium transition-colors"
                    >
                      <PlusIcon className="w-4 h-4" /> Adicionar prescrição
                    </button>
                  )}
                </div>
              </FormSection>

              {/* Lab Orders */}
              <FormSection
                icon={<FlaskIcon className="w-4 h-4" />}
                title="Análises Laboratoriais"
              >
                <div className="space-y-2">
                  {labOrders.map((order, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        value={order}
                        onChange={(e) => updateLabOrder(i, e.target.value)}
                        disabled={submitted}
                        placeholder="Pedido de análise…"
                        className={`flex-1 ${inputCls}`}
                      />
                      {!submitted && (
                        <button
                          onClick={() => removeLabOrder(i)}
                          className="text-stone-400 hover:text-red-500 transition-colors shrink-0"
                        >
                          <XIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!submitted && (
                    <button
                      onClick={addLabOrder}
                      className="flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 font-medium transition-colors"
                    >
                      <PlusIcon className="w-4 h-4" /> Adicionar pedido
                    </button>
                  )}
                </div>
              </FormSection>

              {/* Follow-Up Appointment */}
              <FormSection icon={<CalendarIcon className="w-4 h-4" />} title="Consulta de Seguimento">
                <div className="space-y-2">
                  <input
                    type="date"
                    value={followUpDate}
                    min={(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]; })()}
                    disabled={submitted}
                    onChange={async e => {
                      const date = e.target.value;
                      setFollowUpDate(date);
                      setFollowUp(null);
                      if (!date) { setFollowUpSlots([]); return; }
                      setFollowUpSlotsLoading(true);
                      try {
                        const { slots } = await getDoctorSlots(meeting.doctor!.id, date, token);
                        setFollowUpSlots(slots);
                      } catch {
                        setFollowUpSlots([]);
                      } finally {
                        setFollowUpSlotsLoading(false);
                      }
                    }}
                    className={inputCls}
                  />
                  {followUpDate && (
                    followUpSlotsLoading ? (
                      <p className="text-xs text-stone-400">Loading available slots…</p>
                    ) : followUpSlots.length === 0 ? (
                      <p className="text-xs text-stone-400">No available slots on this date. Try another day.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {followUpSlots.map(slot => {
                          const [h, m] = slot.time.split(':');
                          const hour = parseInt(h);
                          const label = `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
                          const selected = followUp?.date === followUpDate && followUp?.time === slot.time;
                          return (
                            <button
                              key={slot.time}
                              type="button"
                              disabled={submitted}
                              onClick={() => setFollowUp(selected ? null : { date: followUpDate, time: slot.time })}
                              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${selected ? 'bg-[#b5471b] text-white border-[#b5471b]' : 'bg-white text-stone-600 border-stone-200 hover:border-[#b5471b] hover:text-[#b5471b]'}`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )
                  )}
                  {followUp && (
                    <p className="text-xs text-[#b5471b] font-medium">
                      Selected: {new Date(`${followUp.date}T${followUp.time}`).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              </FormSection>

              {/* When to Seek Immediate Care */}
              <FormSection
                icon={<AlertTriangleIcon className="w-4 h-4" />}
                title="Quando Procurar Cuidados Imediatos"
              >
                <div className="space-y-2">
                  {whenToSeekCare.map((item, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        value={item}
                        onChange={(e) =>
                          updateWhenToSeekCare(i, e.target.value)
                        }
                        disabled={submitted}
                        placeholder="Sinal de alerta…"
                        className={`flex-1 ${inputCls}`}
                      />
                      {!submitted && (
                        <button
                          onClick={() => removeWhenToSeekCare(i)}
                          className="text-stone-400 hover:text-red-500 transition-colors shrink-0"
                        >
                          <XIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!submitted && (
                    <button
                      onClick={addWhenToSeekCare}
                      className="flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 font-medium transition-colors"
                    >
                      <PlusIcon className="w-4 h-4" /> Adicionar item
                    </button>
                  )}
                </div>
              </FormSection>
            </div>

            {!submitted && (
              <div className="px-6 py-4 border-t border-stone-100 shrink-0">
                {saveError && (
                  <p className="text-sm text-red-500 mb-3">{saveError}</p>
                )}
                {/* Desktop: single row */}
                <div className="hidden md:flex items-center gap-3 flex-wrap">
                  <button
                    onClick={onBack}
                    className="px-5 py-2.5 text-stone-500 hover:text-stone-900 rounded-full text-sm font-medium transition-colors border border-stone-200 bg-white"
                  >
                    Voltar às consultas
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={generating || saving}
                    className={`flex items-center gap-1.5 px-5 py-2.5 border border-orange-300 text-orange-600 hover:bg-orange-50 disabled:cursor-not-allowed rounded-full text-sm font-medium transition-colors ${generating ? 'cura-ai-shimmer disabled:opacity-100' : 'disabled:opacity-40'}`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {generating ? 'A gerar…' : 'Gerar rascunho'}
                  </button>
                  <button
                    onClick={() => handleSave(false)}
                    disabled={saving || generating}
                    className="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 disabled:opacity-40 disabled:cursor-not-allowed text-stone-700 rounded-full text-sm font-medium transition-colors"
                  >
                    {saving ? 'A guardar…' : 'Guardar rascunho'}
                  </button>
                  <button
                    onClick={() => handleSave(true)}
                    disabled={saving || generating}
                    className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full text-sm font-semibold transition-colors"
                  >
                    Submeter e finalizar
                  </button>
                  <p className="text-xs text-stone-400 ml-1">
                    A submissão bloqueia o resumo permanentemente.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Patient context */}
        <aside className="w-full md:w-60 shrink-0 flex flex-col gap-3">
          {meeting.patient_intake ? (
            <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-3 shrink-0">
              <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">
                Informação pré-consulta
              </p>
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-xs text-stone-400 mb-0.5">Motivo</p>
                  <p className="text-xs text-stone-700 leading-relaxed">
                    {meeting.patient_intake.reason}
                  </p>
                </div>
                {meeting.patient_intake.symptoms && (
                  <div>
                    <p className="text-xs text-stone-400 mb-0.5">Sintomas</p>
                    <p className="text-xs text-stone-700 leading-relaxed">
                      {meeting.patient_intake.symptoms}
                    </p>
                  </div>
                )}
                {meeting.patient_intake.notes && (
                  <div>
                    <p className="text-xs text-stone-400 mb-0.5">Notas</p>
                    <p className="text-xs text-stone-700 leading-relaxed">
                      {meeting.patient_intake.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-stone-50 rounded-xl border border-stone-200 px-4 py-3 shrink-0">
              <p className="text-xs text-stone-400 italic">
                Sem informação pré-consulta disponível.
              </p>
            </div>
          )}

          {profile && (
            <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-3 shrink-0">
              <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">
                Perfil do doente
              </p>
              <div className="flex flex-col gap-2">
                {profile.date_of_birth && (
                  <div>
                    <p className="text-xs text-stone-400 mb-0.5">
                      Data de nascimento
                    </p>
                    <p className="text-xs text-stone-700">
                      {profile.date_of_birth}
                    </p>
                  </div>
                )}
                {profile.sex && (
                  <div>
                    <p className="text-xs text-stone-400 mb-0.5">Sexo</p>
                    <p className="text-xs text-stone-700 capitalize">
                      {profile.sex}
                    </p>
                  </div>
                )}
                {profile.bmi !== null && (
                  <div>
                    <p className="text-xs text-stone-400 mb-0.5">IMC</p>
                    <p className="text-xs text-stone-700">
                      {profile.bmi?.toFixed(1)}
                    </p>
                  </div>
                )}
                {profile.medications.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 mb-1">Medicação</p>
                    <ul className="space-y-1">
                      {profile.medications.map((m, i) => (
                        <li key={i} className="text-xs text-stone-700">
                          {m.name}
                          {m.dose ? ` ${m.dose}` : ''}
                          {m.frequency ? ` · ${m.frequency}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {profile.allergies.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 mb-1">Alergias</p>
                    <ul className="space-y-1">
                      {profile.allergies.map((a, i) => (
                        <li
                          key={i}
                          className={`text-xs font-medium ${a.severity === 'severe' ? 'text-red-600' : a.severity === 'moderate' ? 'text-orange-500' : 'text-stone-700'}`}
                        >
                          {a.substance}{' '}
                          <span className="font-normal text-stone-400">
                            ({a.severity})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {profile.conditions.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 mb-1">Condições</p>
                    <ul className="space-y-0.5">
                      {profile.conditions.map((c, i) => (
                        <li key={i} className="text-xs text-stone-700">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

    </div>
  );
}

function FormSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-orange-500 shrink-0">{icon}</span>
        <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function FormInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-stone-400 mb-1 block">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-sm text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-orange-400/50 focus:border-transparent disabled:opacity-60 disabled:cursor-default"
      />
    </div>
  );
}

function DoctorMeetingRoom({
  meeting,
  patient,
  token,
  currentUser,
  localVideoRef,
  remoteVideoRef,
  connState,
  muted,
  videoOff,
  error,
  suggestions,
  onToggleMute,
  onToggleVideo,
  onEndCall,
}: {
  meeting: Meeting;
  patient: User | null;
  token: string;
  currentUser: User;
  localVideoRef: RefObject<HTMLVideoElement | null>;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  connState: ConnState;
  muted: boolean;
  videoOff: boolean;
  error: string | null;
  suggestions: Suggestion[];
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
}) {
  const [doneSuggestions, setDoneSuggestions] = useState<Set<string>>(new Set());
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [doctorNotes, setDoctorNotes] = useState(meeting.notes ?? '');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (connState !== 'connected') return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [connState]);

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleNotesChange = (value: string) => {
    setDoctorNotes(value);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      updateMeetingNotes(meeting.id, value, token).catch(() => {});
    }, 1000);
  };

  const toggleSuggestion = (id: string) => {
    setDoneSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const patientName = patient
    ? `${patient.first_name} ${patient.last_name}`
    : 'Doente';

  // Mobile: full-screen video layout (mirrors PatientMeetingRoom)
  if (isMobile) {
    const isConnected = connState === 'connected';
    return (
      <div className="relative flex flex-col h-screen bg-black text-white overflow-hidden">
        {/* Remote video fills the screen */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Placeholder when not connected */}
        {!isConnected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
              <Camera className="w-7 h-7 text-white/30" />
            </div>
            <span className="text-white/40 text-sm">{patientName}</span>
          </div>
        )}

        {/* Top bar: logo left, name + timer center, spacer right */}
        <div className="absolute top-5 left-0 right-0 z-10 flex items-center px-6">
          <Image src="/cura.svg" alt="Cura" width={42} height={11} priority className="opacity-60 shrink-0" />
          <div className="flex-1 flex items-center justify-center gap-2">
            <span className="font-medium text-sm text-white/80">{patientName}</span>
            <span className="w-1 h-1 rounded-full bg-white/30 shrink-0" />
            <span className="text-xs text-white/50">
              {isConnected ? formatElapsed(elapsedSeconds) : 'A ligar…'}
            </span>
          </div>
          <div className="w-[42px]" />
        </div>

        {/* Suggestions overlay */}
        {showSuggestions && (
          <div className="absolute inset-0 z-20 bg-black/70 backdrop-blur-sm flex flex-col">
            <div className="flex items-center justify-between px-5 pt-12 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <SparkleIcon className="w-4 h-4 text-orange-400 shrink-0" />
                <span className="font-semibold text-sm text-white">Sugestões Clínicas</span>
              </div>
              <button
                onClick={() => setShowSuggestions(false)}
                className="text-white/40 hover:text-white/80 transition-colors p-1"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-32 space-y-3">
              {suggestions.length === 0 ? (
                <p className="text-xs text-white/40 italic">As sugestões aparecerão à medida que a conversa avança.</p>
              ) : (
                suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    done={doneSuggestions.has(suggestion.id)}
                    onToggle={() => toggleSuggestion(suggestion.id)}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* Self-view PiP */}
        <div className="absolute bottom-28 right-5 z-10 w-28 h-20 rounded-2xl overflow-hidden border border-white/10">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover scale-x-[-1]"
          />
          {videoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <CameraOff className="w-4 h-4 text-white/30" />
            </div>
          )}
        </div>

        {/* Controls glass capsule at bottom */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-3 bg-black/25 backdrop-blur-xl rounded-full px-5 py-3 border border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
            <button
              onClick={onToggleMute}
              aria-label={muted ? 'Ativar microfone' : 'Silenciar'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                muted ? 'bg-[#b5471b] text-white' : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <button
              onClick={onToggleVideo}
              aria-label={videoOff ? 'Ligar câmara' : 'Desligar câmara'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                videoOff ? 'bg-[#b5471b] text-white' : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {videoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setShowSuggestions((v) => !v)}
              aria-label="Sugestões clínicas"
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                showSuggestions ? 'bg-orange-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              <Sparkles className="w-5 h-5" />
            </button>
            <button
              onClick={onEndCall}
              aria-label="Terminar consulta"
              className="w-11 h-11 rounded-full bg-[#b5471b] hover:opacity-90 flex items-center justify-center text-white transition-opacity cursor-pointer"
            >
              <DoorOpen className="w-5 h-5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="absolute bottom-0 left-0 right-0 z-30 px-6 py-3 bg-black/60 backdrop-blur-sm text-sm text-white/60">
            {error}
          </div>
        )}
      </div>
    );
  }

  // Desktop layout
  return (
    <div
      className="flex flex-col h-screen text-black"
      style={{ background: '#ffffff' }}
    >
      <Nav
        user={currentUser}
        token={token}
        wide
        center={
          <div className="flex items-end justify-end w-full gap-2 min-w-0">
            <button
              onClick={onEndCall}
              className="px-3 py-3.5 rounded-full max-h-5 bg-[#b5471b] text-white text-xs% font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5"
            >
              <DoorOpen className="w-4 h-4" /> Terminar
            </button>
          </div>
        }
      />
      <div className="h-26 shrink-0" />

      {/* Main */}
      <div className="flex flex-1 gap-5 px-6 pb-6 overflow-hidden">
        {/* Left: Video + Transcript */}
        <div
          className="flex flex-col gap-4 self-stretch overflow-hidden"
          style={{ flex: '0 0 auto' }}
        >
          {/* Video: 2/5 of viewport height, 16:9 aspect ratio */}
          <div
            className="relative rounded-2xl overflow-hidden bg-black shrink-0"
            style={{ height: '55vh', aspectRatio: '16/9' }}
          >
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />

            {/* Peer status badge */}
            {connState !== 'connected' && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1 pointer-events-none">
                <span className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-pulse" />
                <span className="text-white/70 text-xs">
                  {connState === 'connecting'
                    ? 'A ligar…'
                    : `À espera de ${patientName}…`}
                </span>
              </div>
            )}

            {/* Controls glass capsule */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
              <div className="flex items-center gap-2 bg-black/30 backdrop-blur-xl rounded-full px-4 py-2.5 border border-white/10">
                <button
                  onClick={onToggleMute}
                  aria-label={muted ? 'Ativar microfone' : 'Silenciar'}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    muted
                      ? 'bg-[#b5471b] text-white'
                      : 'bg-white/10 hover:bg-white/20 text-white'
                  }`}
                >
                  {muted ? (
                    <MicOff className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={onToggleVideo}
                  aria-label={videoOff ? 'Ligar câmara' : 'Desligar câmara'}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    videoOff
                      ? 'bg-[#b5471b] text-white'
                      : 'bg-white/10 hover:bg-white/20 text-white'
                  }`}
                >
                  {videoOff ? (
                    <VideoOff className="w-4 h-4" />
                  ) : (
                    <Video className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Self-view PiP */}
            <div className="absolute bottom-3 right-3 w-28 h-20 rounded-xl overflow-hidden bg-black border border-white/10 z-10">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover scale-x-[-1]"
              />
              {videoOff && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <VideoOff className="w-4 h-4 text-white/30" />
                </div>
              )}
            </div>
          </div>

          {/* Doctor Notes */}
          <div className="flex-1 min-h-0 border-t border-black/[0.06] pt-4 pb-2 flex flex-col">
            <span className="text-xs font-medium text-black/35 uppercase tracking-widest mb-3">
              Notas
            </span>
            <textarea
              value={doctorNotes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Escreva as suas notas aqui…"
              maxLength={1000}
              className="flex-1 w-full resize-none text-xs text-stone-700 leading-relaxed bg-transparent placeholder:text-black/20 focus:outline-none"
            />
          </div>
        </div>

        {/* Right: Patient Intake + AI Suggestions */}
        <div className="w-full flex flex-col gap-3 overflow-hidden">
          {/* End call */}
          <div className="flex items-center justify-between shrink-0">
            <div>
              <p className="text-sm font-semibold text-black">{patientName}</p>
              <p className="text-xs text-black/40">{meeting.title}</p>
            </div>
          </div>
          {/* Patient intake */}
          {meeting.patient_intake ? (
            <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-3 shrink-0">
              <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">
                Informação pré-consulta
              </p>
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-xs text-stone-400 mb-0.5">Motivo</p>
                  <p className="text-xs text-stone-700 leading-relaxed">
                    {meeting.patient_intake.reason}
                  </p>
                </div>
                {meeting.patient_intake.symptoms && (
                  <div>
                    <p className="text-xs text-stone-400 mb-0.5">Sintomas</p>
                    <p className="text-xs text-stone-700 leading-relaxed">
                      {meeting.patient_intake.symptoms}
                    </p>
                  </div>
                )}
                {meeting.patient_intake.notes && (
                  <div>
                    <p className="text-xs text-stone-400 mb-0.5">Notas</p>
                    <p className="text-xs text-stone-700 leading-relaxed">
                      {meeting.patient_intake.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-stone-50 rounded-xl border border-stone-200 px-4 py-3 shrink-0">
              <p className="text-xs text-stone-400 italic">
                O doente ainda não preencheu a informação pré-consulta.
              </p>
            </div>
          )}

          <div className="flex-1 bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-4 overflow-y-auto">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <SparkleIcon className="w-4 h-4 text-orange-500 shrink-0" />
                <h2 className="font-semibold text-stone-900 text-sm">
                  Sugestões Clínicas
                </h2>
              </div>
              <p className="text-xs text-stone-400 ml-6">
                Sugestões em tempo real durante a consulta
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {suggestions.length === 0 ? (
                <p className="text-xs text-stone-400 italic">
                  As sugestões aparecerão à medida que a conversa avança.
                </p>
              ) : (
                suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    done={doneSuggestions.has(suggestion.id)}
                    onToggle={() => toggleSuggestion(suggestion.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-8 py-3 text-sm text-[#b5471b] border-t border-[#b5471b]/15">
          {error}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  done,
  onToggle,
}: {
  suggestion: Suggestion;
  done: boolean;
  onToggle: () => void;
}) {
  // Flags carry safety weight, so they get a distinct red treatment regardless
  // of priority. Questions and actions follow priority-based emphasis.
  const isFlag = suggestion.type === 'flag';
  const isHigh = suggestion.priority === 'high';

  const cardClass = isFlag
    ? 'bg-[#b5471b]/5 border-[#b5471b]/20'
    : isHigh
      ? 'bg-orange-50 border-orange-200'
      : 'bg-stone-50 border-stone-100';

  const iconClass = isFlag ? 'text-[#b5471b]' : 'text-orange-500';
  const typeLabel =
    suggestion.type === 'question'
      ? 'Pergunta'
      : suggestion.type === 'action'
        ? 'Ação'
        : suggestion.type === 'flag'
          ? 'Alerta'
          : (suggestion.type as string)[0].toUpperCase() + (suggestion.type as string).slice(1);

  return (
    <div
      className={`p-3 rounded-xl border transition-opacity ${cardClass} ${done ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2 mb-1.5">
        <SparkleIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider ${iconClass}`}
            >
              {typeLabel}
            </span>
            {suggestion.priority !== 'medium' && (
              <span className="text-[10px] text-stone-400 uppercase tracking-wider">
                · {suggestion.priority}
              </span>
            )}
          </div>
          <p className="text-xs text-stone-800 leading-relaxed font-medium">
            {suggestion.text}
          </p>
          <p className="text-[11px] text-stone-500 leading-snug mt-1">
            {suggestion.rationale}
          </p>
        </div>
      </div>
      <div className="flex gap-4 pl-5 mt-1.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 transition-colors cursor-pointer"
        >
          <CheckIcon className="w-3 h-3" />
          {done ? 'Desfazer' : 'Feito'}
        </button>
      </div>
    </div>
  );
}

function PatientMeetingRoom({
  doctor,
  token,
  currentUser,
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
  token: string;
  currentUser: User;
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

  useEffect(() => {
    if (connState !== 'connected') return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [connState]);

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const doctorName = doctor
    ? `Dr. ${doctor.first_name} ${doctor.last_name}`
    : 'Médico/a';

  const isConnected = connState === 'connected';

  return (
    <div className="relative flex flex-col h-screen bg-black text-white overflow-hidden">
      {/* Doctor video fills the screen */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Doctor placeholder when not connected */}
      {!isConnected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
            <Camera className="w-7 h-7 text-white/30" />
          </div>
          <span className="text-white/40 text-sm">{doctorName}</span>
        </div>
      )}

      {/* Top bar: logo left, center info, nothing right */}
      <div className="absolute top-5 left-0 right-0 z-10 flex items-center px-6">
        <Image src="/cura.svg" alt="Cura" width={42} height={11} priority className="opacity-60" />
        <div className="flex-1 flex items-center justify-center gap-2">
          <span className="font-medium text-sm text-white/80">{doctorName}</span>
          <span className="w-1 h-1 rounded-full bg-white/30 shrink-0" />
          <span className="text-xs text-white/50">
            {isConnected ? formatElapsed(elapsedSeconds) : 'A ligar…'}
          </span>
        </div>
        <div className="w-[42px]" />
      </div>

      {/* Transcription notice */}
      <div className="absolute top-14 left-0 right-0 z-10 flex justify-center">
        <p className="text-white/20 text-xs italic">
          Esta consulta está a ser transcrita de forma segura.
        </p>
      </div>

      {/* Self-view PiP */}
      <div className="absolute bottom-28 right-5 z-10 w-28 h-20 rounded-2xl overflow-hidden border border-white/10">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover scale-x-[-1]"
        />
        {videoOff && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <CameraOff className="w-4 h-4 text-white/30" />
          </div>
        )}
      </div>

      {/* Controls glass capsule at bottom */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
        <div className="flex items-center gap-3 bg-black/25 backdrop-blur-xl rounded-full px-5 py-3 border border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
          <button
            onClick={onToggleMute}
            aria-label={muted ? 'Ativar microfone' : 'Silenciar'}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              muted
                ? 'bg-[#b5471b] text-white'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            {muted ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={onToggleVideo}
            aria-label={videoOff ? 'Ligar câmara' : 'Desligar câmara'}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              videoOff
                ? 'bg-[#b5471b] text-white'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            {videoOff ? (
              <VideoOff className="w-5 h-5" />
            ) : (
              <Video className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={onEndCall}
            aria-label="Sair"
            className="w-11 h-11 rounded-full bg-[#b5471b] hover:opacity-90 flex items-center justify-center text-white transition-opacity cursor-pointer"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="absolute bottom-0 left-0 right-0 z-20 px-6 py-3 bg-black/60 backdrop-blur-sm text-sm text-white/60">
          {error}
        </div>
      )}
    </div>
  );
}

function PatientPreMeetingView({
  meeting,
  token,
  currentUser,
}: {
  meeting: Meeting;
  token: string;
  currentUser: User;
}) {
  const [timeUntil, setTimeUntil] = useState(() => getTimeUntilStart(meeting));
  const [reason, setReason] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(
    () => meeting.patient_intake !== null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(
      () => setTimeUntil(getTimeUntilStart(meeting)),
      1_000,
    );
    return () => clearInterval(id);
  }, [meeting]);

  const start = new Date(`${meeting.date}T${meeting.time}`);
  const dateStr = start.toLocaleDateString('pt-PT', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = start.toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const doctorName = meeting.doctor
    ? `Dr. ${meeting.doctor.first_name} ${meeting.doctor.last_name}`
    : 'O seu médico/a';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitMeetingIntake(
        meeting.id,
        {
          reason: reason.trim(),
          symptoms: symptoms.trim() || null,
          notes: notes.trim() || null,
        },
        token,
      );
      setSubmitted(true);
    } catch {
      setSubmitError(
        'Não foi possível guardar as suas informações. Por favor, tente novamente.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex flex-col h-screen bg-[#2a1200] text-white overflow-y-auto">
      <Nav user={currentUser} token={token} />

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
            <p className="font-semibold text-white">
              Informação enviada ao médico/a
            </p>
            <p className="text-white/50 text-sm">
              Esta página abrirá automaticamente quando a sua consulta começar.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-black/40 backdrop-blur-sm rounded-2xl border border-white/10 px-8 py-6 w-full text-left flex flex-col gap-5"
          >
            <div>
              <p className="text-xs font-semibold tracking-widest text-white/40 uppercase mb-1">
                Antes da consulta
              </p>
              <p className="text-white/60 text-sm">
                Ajude o seu médico/a a preparar-se partilhando alguns detalhes.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-white/80">
                Motivo da consulta <span className="text-orange-400">*</span>
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="ex: Consulta de rotina, acompanhamento de tensão arterial"
                maxLength={500}
                required
                className="w-full px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/60 focus:border-transparent"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-white/80">
                Sintomas
              </label>
              <textarea
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="Descreva os sintomas que está a sentir"
                maxLength={1000}
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/60 focus:border-transparent resize-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-white/80">
                Notas adicionais
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Medicação, alergias, ou qualquer outra informação relevante"
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
              {submitting ? 'A guardar…' : 'Enviar ao médico/a'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PatientPostMeetingView({
  meeting: initialMeeting,
  token,
  onBack,
  currentUser,
}: {
  meeting: Meeting;
  token: string;
  onBack: () => void;
  currentUser: User;
}) {
  const [meeting, setMeeting] = useState(initialMeeting);

  useEffect(() => {
    if (meeting.soap_note_submitted) return;
    const id = setInterval(() => {
      getMeeting(meeting.id, token)
        .then(({ meeting: fresh }) => setMeeting(fresh))
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, [meeting.id, meeting.soap_note_submitted, token]);

  const isCanceled =
    meeting.status === 'canceled' || meeting.status === 'rejected';
  const doctorName = meeting.doctor
    ? `Dr. ${meeting.doctor.first_name} ${meeting.doctor.last_name}`
    : 'O seu médico/a';

  const start = new Date(`${meeting.date}T${meeting.time}`);
  const dateStr = start.toLocaleDateString('pt-PT', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = start.toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const endTime = new Date(start.getTime() + meeting.duration * 60_000);
  const endTimeStr = endTime.toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const note = meeting.soap_note_submitted ? meeting.soap_note : null;
  const chiefComplaint = meeting.patient_intake?.reason ?? null;

  if (isCanceled) {
    return (
      <div className="relative flex flex-col min-h-screen bg-[#2a1200] text-white overflow-y-auto">
        <Nav
          user={currentUser}
          token={token}
          wide
          center={
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-stone-500 shrink-0" />
              <span className="text-sm text-white/60">Consulta cancelada</span>
            </div>
          }
        />
        <div className="flex flex-col items-center gap-5 max-w-lg w-full mx-auto px-6 pt-20 pb-10 text-center">
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
            <PhoneOffIcon className="w-8 h-8 text-white/50" />
          </div>
          <p className="text-xl font-semibold text-white">Consulta cancelada</p>
          <p className="text-white/50 text-sm">Esta consulta foi cancelada.</p>
          <button
            onClick={onBack}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-full text-sm font-semibold transition-colors mt-2"
          >
            Voltar às consultas
          </button>
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="relative flex flex-col min-h-screen bg-[#2a1200] text-white overflow-y-auto">
        <Nav
          user={currentUser}
          token={token}
          wide
          center={
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
              <span className="text-sm text-white/70">Consulta concluída</span>
            </div>
          }
        />
        <div className="flex flex-col items-center gap-5 max-w-lg w-full mx-auto px-6 pt-20 pb-10 text-center">
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
            <CheckIcon className="w-8 h-8 text-green-400" />
          </div>
          <p className="text-xl font-semibold text-white">Consulta concluída</p>
          <p className="text-white/50 text-sm">
            A sua consulta com {doctorName} terminou.
          </p>
          <div className="bg-black/40 backdrop-blur-sm rounded-2xl border border-white/10 px-6 py-5 w-full text-center">
            <p className="text-sm text-white/50">
              O resumo da sua consulta aparecerá aqui assim que {doctorName}{' '}
              submeter as notas.
            </p>
            <p className="text-xs text-white/30 mt-2">
              Esta página verifica atualizações automaticamente.
            </p>
          </div>
          <button
            onClick={onBack}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-full text-sm font-semibold transition-colors"
          >
            Voltar às consultas
          </button>
        </div>
      </div>
    );
  }

  const hasVitals = note.vitals && Object.values(note.vitals).some((v) => v);
  // Normalise fields: old meetings may lack these keys
  const diagnoses = note.diagnoses ?? [];
  const treatment_plan = note.treatment_plan ?? [];
  const prescriptions = note.prescriptions ?? [];
  const lab_orders = note.lab_orders ?? [];
  const when_to_seek_care = note.when_to_seek_care ?? [];
  const clinical_assessment = note.clinical_assessment ?? null;
  const follow_up_appointment = note.follow_up_appointment ?? null;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <Nav
        user={currentUser}
        token={token}
        wide
        center={
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm text-black/70 truncate">
              Resumo da Consulta
            </span>
            <span className="w-1 h-1 rounded-full bg-black/20 shrink-0" />
            <span className="text-xs text-black/40 shrink-0">{dateStr}</span>
          </div>
        }
      />

      <div className="max-w-2xl mx-auto px-4 pb-6 space-y-4">
        {/* Doctor / visit info card */}
        <div className="bg-white rounded-2xl border border-stone-200 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-orange-500 flex items-center justify-center text-white shrink-0">
              <PersonIcon className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold text-stone-900">{doctorName}</p>
              <p className="text-xs text-stone-400 mt-0.5">Médico/a</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-stone-100 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">
                Data e Hora
              </p>
              <p className="font-medium text-stone-900">{dateStr}</p>
              <p className="text-xs text-stone-400">
                {timeStr} – {endTimeStr}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">
                Duração
              </p>
              <p className="font-medium text-stone-900">
                {meeting.duration} minutos
              </p>
              <p className="text-xs text-stone-400">
                Consulta por Telemedicina
              </p>
            </div>
            {chiefComplaint && (
              <div className="col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">
                  Queixa Principal
                </p>
                <p className="text-stone-700">{chiefComplaint}</p>
              </div>
            )}
          </div>
        </div>

        {/* Vitals */}
        {hasVitals && (
          <SummarySection
            icon={<HeartPulseIcon className="w-4 h-4" />}
            title="Sinais Vitais Registados"
            defaultOpen
          >
            <div className="grid grid-cols-2 gap-px bg-stone-100 rounded-xl overflow-hidden border border-stone-100">
              {note.vitals!.blood_pressure && (
                <div className="bg-white px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">
                    Pressão Arterial
                  </p>
                  <p className="text-lg font-bold text-stone-900">
                    {note.vitals!.blood_pressure}
                  </p>
                </div>
              )}
              {note.vitals!.heart_rate && (
                <div className="bg-white px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">
                    Frequência Cardíaca
                  </p>
                  <p className="text-lg font-bold text-stone-900">
                    {note.vitals!.heart_rate}
                  </p>
                </div>
              )}
              {note.vitals!.temperature && (
                <div className="bg-white px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">
                    Temperatura
                  </p>
                  <p className="text-lg font-bold text-stone-900">
                    {note.vitals!.temperature}
                  </p>
                </div>
              )}
              {note.vitals!.weight && (
                <div className="bg-white px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">
                    Peso
                  </p>
                  <p className="text-lg font-bold text-stone-900">
                    {note.vitals!.weight}
                  </p>
                </div>
              )}
            </div>
          </SummarySection>
        )}

        {/* Diagnoses */}
        {diagnoses.length > 0 && (
          <SummarySection
            icon={<StethoscopeIcon className="w-4 h-4" />}
            title="Diagnóstico"
            badge={`${diagnoses.length} ${diagnoses.length === 1 ? 'condição' : 'condições'}`}
            defaultOpen
          >
            <div className="space-y-0 divide-y divide-stone-100">
              {diagnoses.map((d, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {d.condition}
                    </p>
                    {d.icd_code && (
                      <p className="text-xs text-stone-400 mt-0.5">
                        ICD-10: {d.icd_code}
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ml-3 ${
                      d.type === 'primary'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {d.type === 'primary' ? 'Principal' : 'Secundário'}
                  </span>
                </div>
              ))}
            </div>
          </SummarySection>
        )}

        {/* Clinical Assessment */}
        {clinical_assessment && (
          <SummarySection
            icon={<ClipboardIcon className="w-4 h-4" />}
            title="Avaliação Clínica"
            defaultOpen={false}
          >
            <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
              {clinical_assessment}
            </p>
          </SummarySection>
        )}

        {/* Treatment Plan */}
        {treatment_plan.length > 0 && (
          <SummarySection
            icon={<ClipboardCheckIcon className="w-4 h-4" />}
            title="Plano de Tratamento"
            badge={`${treatment_plan.length} ${treatment_plan.length === 1 ? 'item' : 'itens'}`}
            defaultOpen
          >
            <ul className="space-y-2.5">
              {treatment_plan.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckIcon className="w-3 h-3 text-green-600" />
                  </div>
                  <p className="text-sm text-stone-700 leading-relaxed">
                    {item}
                  </p>
                </li>
              ))}
            </ul>
          </SummarySection>
        )}

        {/* Prescriptions */}
        {prescriptions.length > 0 && (
          <SummarySection
            icon={<PillIcon className="w-4 h-4" />}
            title="Prescrições"
            badge={`${prescriptions.length} nova${prescriptions.length === 1 ? '' : 's'}`}
            defaultOpen
          >
            <div className="space-y-3">
              {prescriptions.map((rx, i) => (
                <div key={i} className="border border-stone-200 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm text-stone-900">
                        {rx.name}
                      </p>
                      {rx.dosage && (
                        <p className="text-xs text-stone-400 mt-0.5">
                          {rx.dosage}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-xs text-stone-400 shrink-0">
                      {rx.quantity && <p>{rx.quantity}</p>}
                      {rx.refills && <p>{rx.refills} recargas</p>}
                    </div>
                  </div>
                  {rx.instructions && (
                    <p className="text-xs text-stone-500 mt-2 leading-relaxed border-t border-stone-100 pt-2">
                      Instruções: {rx.instructions}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </SummarySection>
        )}

        {/* Lab Orders */}
        {lab_orders.length > 0 && (
          <SummarySection
            icon={<FlaskIcon className="w-4 h-4" />}
            title="Análises Laboratoriais"
            badge={`${lab_orders.length} ${lab_orders.length === 1 ? 'pedido' : 'pedidos'}`}
            defaultOpen={false}
          >
            <ul className="space-y-2">
              {lab_orders.map((order, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 text-sm text-stone-700"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0" />
                  {order}
                </li>
              ))}
            </ul>
          </SummarySection>
        )}

        {/* Follow-Up Appointment */}
        {follow_up_appointment && (
          <SummarySection icon={<CalendarIcon className="w-4 h-4" />} title="Consulta de Seguimento" defaultOpen={false}>
            <p className="text-sm text-stone-700">
              {typeof follow_up_appointment === 'object'
                ? new Date(`${follow_up_appointment.date}T${follow_up_appointment.time}`).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                : follow_up_appointment}
            </p>
          </SummarySection>
        )}

        {/* When to Seek Immediate Care */}
        {when_to_seek_care.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangleIcon className="w-5 h-5 text-red-500 shrink-0" />
              <h2 className="font-semibold text-stone-900">
                Quando Procurar Cuidados Imediatos
              </h2>
            </div>
            <p className="text-xs text-stone-500 mb-3 ml-7">
              Contacte o seu médico/a ou dirija-se ao serviço de urgência se
              sentir:
            </p>
            <ul className="space-y-2 ml-7">
              {when_to_seek_care.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-stone-700"
                >
                  <span className="text-red-400 mt-0.5 shrink-0">•</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-xs font-semibold text-red-600 mt-3 ml-7">
              Urgência: Ligue 112 ou dirija-se à urgência mais próxima.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="bg-stone-100 rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-xs text-stone-500 leading-relaxed">
            Tem dúvidas sobre a sua consulta? Contacte {doctorName} através do
            portal do doente.
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onBack}
              className="px-4 py-2 bg-white border border-stone-200 text-sm font-medium text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
            >
              Voltar ao início
            </button>
            <button className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-sm font-medium text-white rounded-full transition-colors">
              Contactar consultório
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummarySection({
  icon,
  title,
  badge,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-stone-50 transition-colors"
      >
        <span className="text-orange-500 shrink-0">{icon}</span>
        <span className="font-semibold text-stone-900 flex-1 text-sm">
          {title}
        </span>
        {badge && (
          <span className="text-xs font-medium text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
        <ChevronRightIcon
          className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-stone-100">
          <div className="pt-4">{children}</div>
        </div>
      )}
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
          {waiting ? 'À espera…' : 'Câmara desligada'}
        </div>
      )}
      <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-xs">
        {label}
        {muted && <span className="ml-2 text-red-400">em silêncio</span>}
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
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6" />
    </svg>
  );
}

function MicOffIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M18.89 13.23A7 7 0 0019 12M5 10a7 7 0 0012.66 4.13M15 9.34V4a3 3 0 00-5.68-1.33M9 9v3a3 3 0 005.12 2.12" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function CameraOffIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M9 9H1v10a2 2 0 002 2h12a2 2 0 001.73-1M16 5a2 2 0 00-2-2H6.73M23 7l-7 5 7 5V7z" />
    </svg>
  );
}

function ScreenShareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <polyline points="8 21 12 17 16 21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
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
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function StethoscopeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 2v5a5 5 0 0010 0V2" />
      <path d="M12 12v4" />
      <circle cx="12" cy="18" r="2" />
      <path d="M6 2h2M16 2h2" />
    </svg>
  );
}

function PhoneOffIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.68 13.31a16 16 0 003.01 3.01l1.6-1.6a2 2 0 012.05-.45c1.13.4 2.35.62 3.61.62a2 2 0 012 2V21a2 2 0 01-2 2A18 18 0 013 5a2 2 0 012-2h3.5a2 2 0 012 2c0 1.26.22 2.48.62 3.61a2 2 0 01-.45 2.05l-1.6 1.6z" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function HeartPulseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7z" />
      <path d="M3.22 12H9.5l1.5-2 2 4 2-2h3.78" />
    </svg>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2h-3" />
    </svg>
  );
}

function ClipboardCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2h-3" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function PillIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.5 20H4a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v2.5" />
      <path d="M16 15l5-5" />
      <path d="M19 12a3 3 0 110 6 3 3 0 010-6z" />
    </svg>
  );
}

function FlaskIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3h6M9 3v8l-4 9h14l-4-9V3" />
      <path d="M7 15h10" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

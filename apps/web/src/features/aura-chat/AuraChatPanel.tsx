import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AudioLines,
  Check,
  ChevronDown,
  Copy,
  Info,
  Layers,
  MessageSquare,
  Mic,
  PanelRight,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Volume2,
  X,
} from "lucide-react";

import { AuraPyramidStation } from "../../components/AuraPyramidStation";
import { Badge, Button, Input, Switch } from "../../components/ui";
import {
  aiApi,
  audioApi,
  contextEngineApi,
  hermesApi,
  hindsightApi,
  hindsightExploreApi,
  isTauriRuntime,
  raglightApi,
  sessionsApi,
  type AiProviderStatus,
  type ContextInspection,
  type HermesStatus,
  type HermesStreamEvent,
  type HindsightGalaxySnapshot,
  type HindsightRecallItem,
  type HindsightStatus,
  type PersistedChatMessage,
  type RaglightStatus,
} from "../../lib/ipc";
import { encodePcm16WavBase64 } from "../../lib/wav";
import { AuraMarkdownView } from "./AuraMarkdownView";
import { AuraThoughtBlock } from "./AuraThoughtBlock";
import { parseAuraMessageThought } from "./auraThoughtParser";
import {
  loadVoiceSettings,
  speakAuraUtterance,
  stopAuraSpeech,
  type AuraVoiceSettings,
} from "./auraVoiceEngine";
import { AuraAudioPlayer } from "./auraAudioPlayer";
import { AuraSpeechQueue } from "./auraSpeechQueue";
import { probeAuraVoiceService } from "./auraVoiceService";
import { AuraLiveVoiceSession } from "./auraLiveVoice";
import { probeAuraSttService } from "./auraSpeechToText";
import {
  CHAT_CENTERED_WIDTH,
  CHAT_COLUMN_WIDTH,
  chatTransparencyClasses,
  loadChatLayout,
  saveChatLayout,
  type AuraChatLayoutSettings,
} from "./auraChatLayout";
import type { AuraToneAnalysis } from "./auraToneAnalyzer";
import { AuraVoiceSettingsModal } from "./AuraVoiceSettingsModal";

/** Formats the time of a message for the footer. */
function formatMessageTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export interface AuraChatMessage {
  id: string;
  requestId?: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  proposalId?: string | null;
  streaming?: boolean;
}

export interface AuraChatPanelProps {
  sessionId?: string;
  onSessionChange?: (sessionId: string) => void;
  focusMemory?: { bankId: string; memoryId: string } | null;
  onFocusMemoryHandled?: () => void;
  onOpenSessions?: () => void;
  onOpenHindsightBank?: (bankId: string) => void;
  onProposalApplied?: () => void;
  onOpenSettings?: () => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function getAudioCaptureApis() {
  const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  const AudioCtx =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  return { mediaDevices, AudioCtx };
}

export function AuraChatPanel({
  sessionId: sessionIdProp,
  onSessionChange,
  focusMemory = null,
  onFocusMemoryHandled,
  onOpenSessions,
  onOpenHindsightBank,
  onProposalApplied: _onProposalApplied,
  onOpenSettings,
}: AuraChatPanelProps) {
  const { t, i18n } = useTranslation();
  const mountedRef = useRef(true);

  const [internalSessionId, setInternalSessionId] = useState<string>("default");
  const activeSessionId = sessionIdProp ?? internalSessionId;
  const loadedSessionRef = useRef<string>(activeSessionId);

  const [status, setStatus] = useState<HermesStatus>({
    available: false,
    binaryPath: null,
  });
  const [aiStatus, setAiStatus] = useState<AiProviderStatus | null>(null);
  const [hindsightStatus, setHindsightStatus] = useState<HindsightStatus | null>(null);
  const [hindsightMemories, setHindsightMemories] = useState<HindsightRecallItem[]>([]);
  const [galaxySnapshot, setGalaxySnapshot] = useState<HindsightGalaxySnapshot | null>(null);
  const [contextInspection, setContextInspection] = useState<ContextInspection | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [raglightStatus, setRaglightStatus] = useState<RaglightStatus | null>(null);
  const historyLoadedRef = useRef(false);
  const [useCli, setUseCli] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<AuraChatMessage[]>([]);
  const [showTranscript, setShowTranscript] = useState(true);
  const [pulseTick, setPulseTick] = useState(0);
  const [pyramidExpanded, setPyramidExpanded] = useState(false);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Voice capture, Web Speech API & Live Conversation state/refs
  const [recording, setRecording] = useState(false);
  const [savingAudio, setSavingAudio] = useState(false);
  const [voiceBanner, setVoiceBanner] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [liveSpeaking, setLiveSpeaking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<AuraVoiceSettings>(loadVoiceSettings);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Neural voice (local Kokoro service). `voiceServiceReady` gates the
  // engine: when the container is not running we fall back to the browser
  // `SpeechSynthesis` engine instead of going silent.
  const [voiceServiceReady, setVoiceServiceReady] = useState(false);
  const [sttServiceReady, setSttServiceReady] = useState(false);
  const [liveTone, setLiveTone] = useState<AuraToneAnalysis | null>(null);
  // Dock position and transparency of the conversation column.
  const [chatLayout, setChatLayout] = useState<AuraChatLayoutSettings>(loadChatLayout);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layoutMenuOpen) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
        setLayoutMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [layoutMenuOpen]);

  // Status / actions menu floating over the 3D station.
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!statusMenuOpen) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusMenuOpen]);
  const voicePlayerRef = useRef<AuraAudioPlayer | null>(null);
  const speechQueueRef = useRef<AuraSpeechQueue | null>(null);
  const liveVoiceRef = useRef<AuraLiveVoiceSession | null>(null);
  /** Sink for the microphone chunks in live mode (local Whisper). */
  const liveChunkSinkRef = useRef<((chunk: Float32Array) => void) | null>(null);
  if (!voicePlayerRef.current) {
    voicePlayerRef.current = new AuraAudioPlayer();
  }

  // Voice dropdown open
  const [voiceDropOpen, setVoiceDropOpen] = useState(false);
  const voiceDropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!voiceDropOpen) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (voiceDropRef.current && !voiceDropRef.current.contains(e.target as Node)) {
        setVoiceDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [voiceDropOpen]);

  // Floating Station HUD popover for 3D canvas (replaces clutter on top of triangle)
  const [stationHudOpen, setStationHudOpen] = useState(false);
  const stationHudRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stationHudOpen) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (stationHudRef.current && !stationHudRef.current.contains(e.target as Node)) {
        setStationHudOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [stationHudOpen]);

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const recordingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveModeRef = useRef(false);
  const sendingRef = useRef(false);
  /** Request id of the reply being streamed, so it can be stopped. */
  const activeRequestIdRef = useRef<string | null>(null);
  /** The last prompt, so a failed turn can be retried with one click. */
  const lastPromptRef = useRef<string | null>(null);
  /** True while the user scrolled away from the bottom of the transcript. */
  const [atBottom, setAtBottom] = useState(true);
  /** Message the user is editing (user messages only). */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const streamBuffersRef = useRef<Map<string, string>>(new Map());
  // How many characters of the answer were already handed to the speech
  // queue, per request. Keeps real-time speech from repeating text.
  const spokenOffsetsRef = useRef<Map<string, number>>(new Map());
  const sendPromptRef = useRef<(textOverride?: string) => Promise<void>>(async () => {});
  const speakReplyRef = useRef<(text: string) => void>(() => {});

  const speechLang = i18n.language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en-US";

  const stopAudioTracks = useCallback(() => {
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore disconnect errors during teardown
    }
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    recognitionRef.current = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {
        // ignore speech recognition stop errors
      }
    }
  }, []);

  const stopSpeechSynthesis = useCallback(() => {
    stopAuraSpeech();
    speechQueueRef.current?.stop();
    if (mountedRef.current) setLiveSpeaking(false);
  }, []);

  /**
   * True when the local neural voice can be used: the user picked the
   * neural engine, the container is up, and auto-speak is on (auto-speak is
   * bypassed in live conversation mode).
   */
  const canUseNeuralVoice = useCallback(
    () =>
      voiceSettings.engine === "neural" &&
      voiceServiceReady &&
      (liveModeRef.current || voiceSettings.autoSpeak),
    [voiceSettings, voiceServiceReady]
  );

  /**
   * Returns the speech queue for the current voice settings, creating it on
   * first use. The queue synthesizes sentence by sentence so the reply is
   * audible while it is still being written.
   */
  const ensureSpeechQueue = useCallback((): AuraSpeechQueue | null => {
    if (!canUseNeuralVoice()) return null;
    const player = voicePlayerRef.current;
    if (!player) return null;

    const queue = speechQueueRef.current;
    if (queue) return queue;

    const created = new AuraSpeechQueue({
      voice: voiceSettings.serviceVoice,
      speed: voiceSettings.speed,
      player,
      onStateChange: (state) => {
        if (mountedRef.current) setLiveSpeaking(state === "speaking");
      },
      onError: (error) => {
        if (mountedRef.current) setErrorMsg(error.message);
      },
    });
    speechQueueRef.current = created;
    return created;
  }, [canUseNeuralVoice, voiceSettings.serviceVoice, voiceSettings.speed]);

  // Rebuild the queue when the voice or the rate changes.
  useEffect(() => {
    speechQueueRef.current?.reset();
    speechQueueRef.current = null;
  }, [voiceSettings.serviceVoice, voiceSettings.speed, voiceSettings.engine]);

  // Probe the local voice service so we know whether the neural engine is
  // available before the first reply.
  useEffect(() => {
    let active = true;
    const probe = async () => {
      const status = await probeAuraVoiceService();
      const stt = await probeAuraSttService();
      if (!active) return;
      setVoiceServiceReady(status.available);
      setSttServiceReady(stt);
    };
    void probe();
    const timer = setInterval(() => void probe(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const speakReply = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (!liveModeRef.current && !voiceSettings.autoSpeak) return;

      const parsed = parseAuraMessageThought(text);
      const answer = parsed.answer || parsed.thought || "";
      if (!answer.trim()) return;

      const queue = ensureSpeechQueue();
      if (queue) {
        void voicePlayerRef.current?.resume();
        queue.push(answer);
        void queue.flush();
        return;
      }

      speakAuraUtterance(
        answer,
        voiceSettings,
        () => {
          if (mountedRef.current) setLiveSpeaking(true);
        },
        () => {
          if (mountedRef.current) setLiveSpeaking(false);
        },
        () => {
          if (mountedRef.current) setLiveSpeaking(false);
        }
      );
    },
    [ensureSpeechQueue, voiceSettings]
  );

  const handleSpeakMessage = useCallback(
    (text: string) => {
      const parsed = parseAuraMessageThought(text);
      const answer = parsed.answer || parsed.thought || "";
      if (!answer.trim()) return;

      const queue = ensureSpeechQueue();
      if (queue) {
        void voicePlayerRef.current?.resume();
        queue.push(answer);
        void queue.flush();
        return;
      }

      speakAuraUtterance(
        answer,
        voiceSettings,
        () => {
          if (mountedRef.current) setLiveSpeaking(true);
        },
        () => {
          if (mountedRef.current) setLiveSpeaking(false);
        },
        () => {
          if (mountedRef.current) setLiveSpeaking(false);
        }
      );
    },
    [ensureSpeechQueue, voiceSettings]
  );

  const handleCopyMessage = useCallback(async (text: string, msgId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    speakReplyRef.current = speakReply;
  }, [speakReply]);

  useEffect(() => {
    if (loadedSessionRef.current !== activeSessionId) {
      loadedSessionRef.current = activeSessionId;
      historyLoadedRef.current = false;
      setMessages([]);
    }
  }, [activeSessionId]);

  const loadData = useCallback(async () => {
    try {
      const targetSession = activeSessionId || "default";
      const [
        hermesInfo,
        providerInfo,
        hindsightInfo,
        memoriesInfo,
        raglightInfo,
        persistedHistory,
        snapshotInfo,
        ctxInfo,
      ] = await Promise.all([
        hermesApi.status().catch(() => ({ available: false, binaryPath: null })),
        aiApi?.providerStatus?.()?.catch(() => null) ?? Promise.resolve(null),
        hindsightApi?.status?.()?.catch(() => null) ?? Promise.resolve(null),
        hindsightApi?.recall?.("", null, 24)?.catch(() => [] as HindsightRecallItem[]) ??
          Promise.resolve([] as HindsightRecallItem[]),
        raglightApi?.status?.()?.catch(() => null) ?? Promise.resolve(null),
        !historyLoadedRef.current && aiApi?.chatHistory
          ? aiApi.chatHistory(50, targetSession).catch(() => [] as PersistedChatMessage[])
          : Promise.resolve(null),
        hindsightExploreApi?.galaxySnapshot?.(null, 14)?.catch(() => null) ??
          Promise.resolve(null),
        contextEngineApi?.inspect?.(targetSession)?.catch(() => null) ??
          Promise.resolve(null),
      ]);
      if (!mountedRef.current) return;
      setStatus(hermesInfo);
      if (providerInfo) setAiStatus(providerInfo);
      setHindsightStatus(hindsightInfo ?? null);
      if (Array.isArray(memoriesInfo) && memoriesInfo.length > 0) {
        setHindsightMemories([...memoriesInfo]);
      }
      setRaglightStatus(raglightInfo ?? null);
      if (snapshotInfo) {
        setGalaxySnapshot(snapshotInfo);
      }
      if (ctxInfo) {
        setContextInspection(ctxInfo);
      }
      if (persistedHistory !== null) {
        historyLoadedRef.current = true;
        if (Array.isArray(persistedHistory)) {
          const mapped = persistedHistory
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              text: m.content,
              createdAt: m.createdAt,
            }));
          if (mapped.length > 0) {
            setMessages((prev) => (prev.length > 0 ? prev : mapped));
          }
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(String(err));
    }
  }, [activeSessionId]);

  const handleNewSession = useCallback(async () => {
    if (creatingSession || !sessionsApi?.create) return;
    setCreatingSession(true);
    setErrorMsg(null);
    try {
      const created = await sessionsApi.create();
      if (!mountedRef.current) return;
      historyLoadedRef.current = true;
      loadedSessionRef.current = created.id;
      setInternalSessionId(created.id);
      onSessionChange?.(created.id);
      setMessages([]);
      setFeedback(t("hermes.sessionBadge", { title: t(created.title, { defaultValue: created.title }) }));
      const ctx = await contextEngineApi?.inspect?.(created.id)?.catch(() => null);
      if (mountedRef.current && ctx) {
        setContextInspection(ctx);
      }
    } catch (err) {
      if (mountedRef.current) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) setCreatingSession(false);
    }
  }, [creatingSession, onSessionChange, t]);

  useEffect(() => {
    mountedRef.current = true;
    void loadData();

    if (!isTauriRuntime()) {
      return () => {
        mountedRef.current = false;
        liveModeRef.current = false;
        recordingRef.current = false;
        stopSpeechRecognition();
        stopSpeechSynthesis();
        stopAudioTracks();
      };
    }

    let active = true;
    const unlisteners: Array<() => void> = [];
    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const [uStream, uProps] = await Promise.all([
          listen<HermesStreamEvent>("auradesk://hermes-stream", (ev) => {
            const { requestId, chunk, done } = ev.payload;
            if (!mountedRef.current) return;
            const prevAcc = streamBuffersRef.current.get(requestId) ?? "";
            const nextAcc = prevAcc ? `${prevAcc}\n${chunk}` : chunk;

            // Real-time speech: push only the answer text that was not
            // spoken yet, sentence by sentence, while the reply is still
            // being generated. The reasoning block is never spoken.
            const queue = speechQueueRef.current;
            if (queue) {
              const answer = parseAuraMessageThought(nextAcc).answer;
              const already = spokenOffsetsRef.current.get(requestId) ?? 0;
              if (answer.length < already) {
                // The answer shrank (a thought block closed): restart from
                // the beginning rather than skipping text.
                spokenOffsetsRef.current.set(requestId, 0);
                if (answer.trim()) {
                  spokenOffsetsRef.current.set(requestId, answer.length);
                  queue.push(answer);
                }
              } else if (answer.length > already) {
                spokenOffsetsRef.current.set(requestId, answer.length);
                queue.push(answer.slice(already));
              }
            }

            if (done) {
              streamBuffersRef.current.delete(requestId);
              spokenOffsetsRef.current.delete(requestId);
              if (queue) {
                void queue.flush();
              } else if (nextAcc.trim()) {
                speakReplyRef.current(nextAcc);
              }
            } else {
              streamBuffersRef.current.set(requestId, nextAcc);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.requestId === requestId
                  ? {
                      ...m,
                      text: m.streaming ? `${m.text}${m.text ? "\n" : ""}${chunk}` : chunk,
                      streaming: !done,
                    }
                  : m
              )
            );
          }),
          listen("auradesk://proposals-updated", () => {
            if (mountedRef.current) void loadData();
          }),
        ]);
        if (active) {
          unlisteners.push(uStream, uProps);
        } else {
          uStream();
          uProps();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      mountedRef.current = false;
      liveModeRef.current = false;
      recordingRef.current = false;
      stopSpeechRecognition();
      stopSpeechSynthesis();
      stopAudioTracks();
      unlisteners.forEach((fn) => fn());
    };
  }, [loadData, stopAudioTracks, stopSpeechRecognition, stopSpeechSynthesis]);

  useEffect(() => {
    if (showTranscript && transcriptRef.current && atBottom) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages, showTranscript, atBottom]);

  /** Tracks whether the transcript is scrolled to the bottom. */
  const handleTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < 60);
  }, []);

  /** Scrolls the transcript back to the newest message. */
  const scrollToLatest = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAtBottom(true);
  }, []);

  /**
   * Stops the reply that is currently streaming.
   *
   * The backend kills the CLI child; the stream then emits its final
   * `done` event and the UI settles normally.
   */
  const stopGeneration = useCallback(async () => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;
    try {
      await hermesApi.cancel(requestId);
    } catch {
      // The stream may have finished on its own — nothing to report.
    }
  }, []);

  // Escape stops the generation, the way it does in every other assistant.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editingMessageId !== null) {
        setEditingMessageId(null);
        setEditingText("");
        return;
      }
      if (sendingRef.current) {
        e.preventDefault();
        void stopGeneration();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [stopGeneration, editingMessageId]);

  const sendPrompt = useCallback(
    async (textOverride?: string) => {
      const raw = (textOverride ?? prompt).trim();
      if (!raw || sendingRef.current) return;

      sendingRef.current = true;
      lastPromptRef.current = raw;
      setSending(true);
      setErrorMsg(null);
      setFeedback(null);
      setShowTranscript(true);
      setPulseTick((c) => c + 1);

      // Fire background Hindsight recall + optional RAGLight query immediately to light up 3D pulses
      void Promise.all([
        hindsightApi?.recall?.(raw, null, 24)?.catch(() => null) ?? Promise.resolve(null),
        raglightStatus?.enabled
          ? raglightApi?.query?.(raw, 4)?.catch(() => null) ?? Promise.resolve(null)
          : Promise.resolve(null),
      ]).then(([recalled]) => {
        if (!mountedRef.current) return;
        if (Array.isArray(recalled) && recalled.length > 0) {
          setHindsightMemories([...recalled]);
        }
      });

      const nowIso = new Date().toISOString();
      const userMsg: AuraChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        text: raw,
        createdAt: nowIso,
      };
      setMessages((prev) => [...prev, userMsg]);
      if (!textOverride) setPrompt("");

      try {
        const reply = await hermesApi.sendMessage(
          raw,
          status.available && useCli,
          activeSessionId
        );
        if (!mountedRef.current) return;
        activeRequestIdRef.current = reply.streaming ? reply.requestId : null;
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${reply.requestId}`,
            requestId: reply.requestId,
            role: "assistant",
            text: reply.replyText,
            createdAt: new Date().toISOString(),
            proposalId: reply.proposal?.id ?? null,
            streaming: reply.streaming,
          },
        ]);
        if (liveModeRef.current && !reply.streaming && reply.replyText) {
          speakReply(reply.replyText);
        }
        await loadData();
      } catch (err) {
        if (!mountedRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        sendingRef.current = false;
        activeRequestIdRef.current = null;
        if (mountedRef.current) setSending(false);
      }
    },
    [
      activeSessionId,
      loadData,
      prompt,
      raglightStatus?.enabled,
      speakReply,
      status.available,
      useCli,
    ]
  );

  useEffect(() => {
    sendPromptRef.current = sendPrompt;
  }, [sendPrompt]);

  /** Waits for a running stream to settle before starting a new one. */
  const settleRunningStream = useCallback(async () => {
    if (!activeRequestIdRef.current) return;
    await stopGeneration();
    // The backend emits the final `done` event right after the kill.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }, [stopGeneration]);

  /**
   * Asks the assistant again, replacing the previous answer.
   *
   * The messages after the last user turn are dropped so the thread does
   * not keep two different answers to the same question.
   */
  const regenerateLastAnswer = useCallback(async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;

    await settleRunningStream();
    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === lastUser.id);
      return index >= 0 ? prev.slice(0, index + 1) : prev;
    });
    await sendPromptRef.current(lastUser.text);
  }, [messages, settleRunningStream]);

  /** Starts editing a user message so it can be sent again. */
  const startEditingMessage = useCallback((messageId: string, text: string) => {
    setEditingMessageId(messageId);
    setEditingText(text);
  }, []);

  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditingText("");
  }, []);

  /** Replaces an edited user message and asks again. */
  const submitEditedMessage = useCallback(async () => {
    const text = editingText.trim();
    const messageId = editingMessageId;
    if (!text || !messageId) return;

    setEditingMessageId(null);
    setEditingText("");

    await settleRunningStream();
    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === messageId);
      if (index < 0) return prev;
      const next = prev.slice();
      next[index] = { ...next[index], text };
      // Drop the previous answer: it belongs to the old wording.
      return next.slice(0, index + 1);
    });
    await sendPromptRef.current(text);
  }, [editingText, editingMessageId, settleRunningStream]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendPrompt();
  };

  const stopAndSaveWavCapture = useCallback(async () => {
    const sampleRate = audioCtxRef.current?.sampleRate ?? 16_000;
    const chunks = pcmChunksRef.current;
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    stopAudioTracks();
    recordingRef.current = false;
    setRecording(false);
    setSavingAudio(true);
    setVoiceBanner(null);

    try {
      const b64 = encodePcm16WavBase64(chunks, sampleRate);
      const saved = await audioApi.saveVoiceCapture(b64, "hermes-voice");
      if (!mountedRef.current) return;
      setVoiceBanner(t("hermes.voice.saved", { bytes: saved.bytes, path: saved.filePath }));
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : t("hermes.voice.failed"));
    } finally {
      if (mountedRef.current) setSavingAudio(false);
    }
  }, [stopAudioTracks, t]);

  const startWavCapture = useCallback(
    async (silentIfUnsupported = false): Promise<boolean> => {
      const { mediaDevices, AudioCtx } = getAudioCaptureApis();
      if (!mediaDevices?.getUserMedia || !AudioCtx) {
        if (!silentIfUnsupported) {
          setErrorMsg(t("hermes.voice.unsupported"));
        }
        return false;
      }

      setErrorMsg(null);
      if (!silentIfUnsupported) setVoiceBanner(null);
      try {
        const stream = await mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        pcmChunksRef.current = [];
        processor.onaudioprocess = (ev) => {
          const channel = ev.inputBuffer.getChannelData(0);
          const chunk = new Float32Array(channel);
          pcmChunksRef.current.push(chunk);
          // In live mode the same audio feeds the local Whisper stream.
          liveChunkSinkRef.current?.(chunk);
        };
        source.connect(processor);
        processor.connect(ctx.destination);

        streamRef.current = stream;
        audioCtxRef.current = ctx;
        processorRef.current = processor;
        recordingRef.current = true;
        setRecording(true);
        return true;
      } catch {
        stopAudioTracks();
        if (!silentIfUnsupported) {
          setErrorMsg(t("hermes.voice.failed"));
        }
        return false;
      }
    },
    [stopAudioTracks, t]
  );

  const toggleVoiceCapture = useCallback(async () => {
    if (recordingRef.current) {
      await stopAndSaveWavCapture();
      return;
    }
    await startWavCapture(false);
  }, [startWavCapture, stopAndSaveWavCapture]);

  const toggleLiveMode = useCallback(async () => {
    if (liveModeRef.current) {
      liveModeRef.current = false;
      setLiveMode(false);
      stopSpeechRecognition();
      stopSpeechSynthesis();
      liveChunkSinkRef.current = null;
      const session = liveVoiceRef.current;
      liveVoiceRef.current = null;
      if (session) await session.stop();
      if (recordingRef.current) {
        await stopAndSaveWavCapture();
      }
      return;
    }

    if (transcribing) {
      setTranscribing(false);
      stopSpeechRecognition();
    }
    if (recordingRef.current) {
      await stopAndSaveWavCapture();
    }

    setErrorMsg(null);
    setVoiceBanner(null);
    setLiveTone(null);

    // Preferred path: the local Whisper service transcribes in Brazilian
    // Portuguese with real incremental results. The browser Web Speech API
    // is only used when the service is unavailable.
    if (sttServiceReady) {
      const session = new AuraLiveVoiceSession({
        language: speechLang.startsWith("pt") ? "pt" : "en",
        sampleRate: 48_000,
        onInterim: (text) => {
          if (mountedRef.current) setPrompt(text);
        },
        onFinal: (text) => {
          if (!mountedRef.current || !text.trim()) return;
          setPrompt("");
          void sendPromptRef.current(text.trim());
        },
        onTone: (analysis) => {
          if (mountedRef.current) setLiveTone(analysis);
        },
        onError: (error) => {
          if (mountedRef.current) setErrorMsg(error.message);
        },
      });

      const started = await session.start();
      if (started) {
        liveVoiceRef.current = session;
        liveModeRef.current = true;
        setLiveMode(true);
        const captured = await startWavCapture(true);
        if (captured) {
          const rate = audioCtxRef.current?.sampleRate ?? 48_000;
          liveChunkSinkRef.current = (chunk) => session.push(chunk, rate);
        } else {
          liveVoiceRef.current = null;
          await session.stop();
          liveModeRef.current = false;
          setLiveMode(false);
        }
        return;
      }
    }

    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      liveModeRef.current = true;
      setLiveMode(true);
      setVoiceBanner(t("hermes.voice.liveUnsupported"));
      await startWavCapture(true);
      return;
    }

    try {
      const recognition = new RecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = speechLang;

      recognition.onresult = (ev) => {
        if (!mountedRef.current || !liveModeRef.current) return;
        const finalParts: string[] = [];
        const interimParts: string[] = [];
        for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
          const res = ev.results[i];
          const text = res?.[0]?.transcript?.trim() ?? "";
          if (!text) continue;
          if (res.isFinal) {
            finalParts.push(text);
          } else {
            interimParts.push(text);
          }
        }
        if (interimParts.length > 0) {
          setPrompt(interimParts.join(" ").trim());
        }
        if (finalParts.length > 0) {
          const finalUtterance = finalParts.join(" ").trim();
          if (finalUtterance) {
            setPrompt("");
            void sendPromptRef.current(finalUtterance);
          }
        }
      };

      recognition.onerror = (ev) => {
        if (!mountedRef.current) return;
        if (
          ev.error === "not-allowed" ||
          ev.error === "service-not-allowed" ||
          ev.error === "audio-capture"
        ) {
          liveModeRef.current = false;
          setLiveMode(false);
          stopSpeechRecognition();
          setErrorMsg(t("hermes.voice.failed"));
        }
      };

      recognition.onend = () => {
        if (!mountedRef.current) return;
        if (liveModeRef.current && recognitionRef.current === recognition) {
          try {
            recognition.start();
          } catch {
            liveModeRef.current = false;
            setLiveMode(false);
            recognitionRef.current = null;
          }
        }
      };

      recognitionRef.current = recognition;
      liveModeRef.current = true;
      setLiveMode(true);
      recognition.start();
    } catch {
      stopSpeechRecognition();
      liveModeRef.current = true;
      setLiveMode(true);
      setVoiceBanner(t("hermes.voice.liveUnsupported"));
      await startWavCapture(true);
    }
  }, [
    speechLang,
    startWavCapture,
    stopAndSaveWavCapture,
    stopSpeechRecognition,
    stopSpeechSynthesis,
    t,
    transcribing,
  ]);

  const handleTranscribeOrVoiceClick = useCallback(async () => {
    if (recordingRef.current) {
      await stopAndSaveWavCapture();
      return;
    }
    if (transcribing) {
      setTranscribing(false);
      stopSpeechRecognition();
      return;
    }

    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      await toggleVoiceCapture();
      return;
    }

    if (liveModeRef.current) {
      liveModeRef.current = false;
      setLiveMode(false);
      stopSpeechRecognition();
      stopSpeechSynthesis();
    }

    setErrorMsg(null);
    setVoiceBanner(null);

    try {
      const recognition = new RecognitionCtor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = speechLang;

      const prefix = prompt.trim();

      recognition.onresult = (ev) => {
        if (!mountedRef.current) return;
        const parts: string[] = [];
        for (let i = 0; i < ev.results.length; i += 1) {
          const text = ev.results[i]?.[0]?.transcript?.trim() ?? "";
          if (text) parts.push(text);
        }
        const spoken = parts.join(" ").trim();
        if (spoken) {
          setPrompt(prefix ? `${prefix} ${spoken}` : spoken);
        }
      };

      recognition.onerror = () => {
        if (!mountedRef.current) return;
        setTranscribing(false);
        stopSpeechRecognition();
        setErrorMsg(t("hermes.voice.failed"));
      };

      recognition.onend = () => {
        if (!mountedRef.current) return;
        setTranscribing(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      setTranscribing(true);
      recognition.start();
    } catch {
      setTranscribing(false);
      stopSpeechRecognition();
      await toggleVoiceCapture();
    }
  }, [
    prompt,
    speechLang,
    stopAndSaveWavCapture,
    stopSpeechRecognition,
    stopSpeechSynthesis,
    t,
    toggleVoiceCapture,
    transcribing,
  ]);

  const transparency = chatTransparencyClasses(chatLayout.transparency);

  const updateChatLayout = (patch: Partial<AuraChatLayoutSettings>) => {
    const next = { ...chatLayout, ...patch };
    setChatLayout(next);
    saveChatLayout(next);
  };

  // In the centered mode the station spans the full width behind the panel,
  // so the pyramid is expanded to keep the map as the main visual.
  useEffect(() => {
    if (chatLayout.dock === "center") setPyramidExpanded(true);
  }, [chatLayout.dock]);

  return (
    <div className="relative flex-1 h-full w-full min-h-[540px] flex flex-col lg:flex-row overflow-hidden">
      {/* Voice Settings Modal */}
      <AuraVoiceSettingsModal
        open={voiceSettingsOpen}
        onClose={() => setVoiceSettingsOpen(false)}
        settings={voiceSettings}
        onSettingsChange={setVoiceSettings}
      />

      {/* Main 3D Holographic Pyramid Station & Memory Universe */}
      <div
        className={`relative flex-1 h-full w-full min-h-0 overflow-hidden flex flex-col ${
          chatLayout.dock === "left" ? "lg:order-2" : "lg:order-1"
        }`}
      >
        <AuraPyramidStation
          aiStatus={aiStatus}
          hindsightStatus={hindsightStatus}
          raglightStatus={raglightStatus}
          memories={hindsightMemories}
          galaxySnapshot={galaxySnapshot}
          focusedMemoryId={focusMemory?.memoryId ?? null}
          onFocusedMemoryHandled={onFocusMemoryHandled}
          onOpenHindsightBank={onOpenHindsightBank}
          activePulseTick={pulseTick}
          speaking={sending || liveSpeaking || messages.some((m) => m.streaming)}
          listening={prompt.trim().length > 0 || recording || liveMode || transcribing}
          expanded={pyramidExpanded}
          onExpandedChange={setPyramidExpanded}
          onOpenSettings={onOpenSettings}
        />

        {/* Floating control: the status chrome lives in this menu.
            Anchored bottom-left: the station's own controls occupy the top
            row of the canvas. */}
        <div className="aura-galaxy-chrome-scope pointer-events-none absolute bottom-4 left-4 z-10">
          <div className="pointer-events-auto relative" ref={statusMenuRef}>
            <button
              type="button"
              data-testid="aura-status-menu-btn"
              onClick={() => setStatusMenuOpen((v) => !v)}
              aria-label={t("hermes.statusMenu")}
              title={t("hermes.statusMenu")}
              aria-expanded={statusMenuOpen}
              className="relative inline-flex h-7 w-7 items-center justify-center rounded-full border border-sky-400/30 bg-slate-950/70 backdrop-blur-md text-sky-300 transition-colors hover:border-sky-400/60 hover:text-sky-200"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              {(aiStatus?.ready || status.available || messages.length > 0) && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400"
                  aria-hidden="true"
                />
              )}
            </button>

            {statusMenuOpen && (
              <div className="absolute bottom-9 left-0 z-50 w-72 rounded-xl border border-sky-400/25 bg-slate-950/95 backdrop-blur-xl shadow-2xl p-2.5 flex flex-col gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-testid="aura-new-session-btn"
                  disabled={creatingSession}
                  onClick={() => {
                    setStatusMenuOpen(false);
                    void handleNewSession();
                  }}
                  className="h-7 w-full justify-start rounded-lg border border-sky-400/30 bg-slate-900/60 px-2.5 text-[11px] text-sky-200 hover:bg-sky-500/15"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  {t("hermes.newSession")}
                </Button>

                {contextInspection && (
                  <button
                    type="button"
                    data-testid="aura-context-pill"
                    onClick={() => {
                      setStatusMenuOpen(false);
                      onOpenSessions?.();
                    }}
                    className="inline-flex w-full items-center gap-1.5 rounded-lg border border-sky-400/20 bg-slate-900/50 px-2.5 py-1.5 text-[11px] text-sky-200 hover:border-sky-400/50 cursor-pointer"
                  >
                    <Layers className="h-3 w-3 text-sky-400" aria-hidden="true" />
                    <span>{t("hermes.contextPill", { pct: contextInspection.usagePct })}</span>
                  </button>
                )}

                {aiStatus && (
                  <Badge
                    variant={aiStatus.ready ? "info" : "warning"}
                    className="w-full justify-start rounded-lg bg-slate-900/50 px-2 py-1 text-[11px]"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    {t("hermes.providerBadge", {
                      provider: aiStatus.activeProvider,
                      model: aiStatus.model,
                    })}
                  </Badge>
                )}

                <Badge
                  variant={status.available ? "success" : "neutral"}
                  className="w-full justify-start rounded-lg bg-slate-900/50 px-2 py-1 text-[11px]"
                >
                  <Terminal className="h-3 w-3" aria-hidden="true" />
                  {status.available
                    ? t("hermes.cliOnline", { path: status.binaryPath ?? "hermes" })
                    : t("hermes.cliOffline")}
                </Badge>

                {status.available && (
                  <label className="inline-flex w-full items-center gap-2 rounded-lg border border-sky-400/15 bg-slate-900/50 px-2.5 py-1.5 text-[11px] text-slate-200 cursor-pointer">
                    <Switch
                      checked={useCli}
                      onCheckedChange={setUseCli}
                      aria-label={t("hermes.useCliLabel")}
                    />
                    <span>{t("hermes.useCliLabel")}</span>
                  </label>
                )}

                {messages.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-expanded={showTranscript}
                    onClick={() => setShowTranscript((v) => !v)}
                    className="h-7 w-full justify-start rounded-lg border border-sky-400/20 bg-slate-900/50 px-2.5 text-[11px] text-sky-200 hover:bg-sky-500/15"
                  >
                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                    {t("hermes.voice.toggleTranscript", { count: messages.length })}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Conversation column */}
      <div
        data-testid="aura-chat-panel"
        className={`h-full flex flex-col min-h-0 ${transparency.blur} shadow-2xl ${
          chatLayout.dock === "center"
            ? `absolute inset-y-0 left-1/2 -translate-x-1/2 z-30 ${CHAT_CENTERED_WIDTH} rounded-none border-x ${transparency.border} ${transparency.container}`
            : `relative z-20 ${CHAT_COLUMN_WIDTH} ${
                chatLayout.dock === "left" ? "lg:order-1 border-r" : "lg:order-2 border-l"
              } ${transparency.border} ${transparency.container}`
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between border-b border-sky-400/15 px-4 py-3 shrink-0 ${transparency.header}`}>
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
            <span className="truncate text-xs font-semibold text-slate-100">
              {t("hermes.chatTitle")}
            </span>
            {messages.length > 0 && (
              <Badge variant="neutral" className="h-4 shrink-0 rounded-full px-1.5 py-0 text-[10px]">
                {messages.length}
              </Badge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Dock position + transparency */}
            <div className="relative" ref={layoutMenuRef}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="aura-layout-menu-btn"
                onClick={() => setLayoutMenuOpen((v) => !v)}
                className="h-7 px-2 text-[11px] text-slate-300 hover:text-white rounded-full"
                aria-label={t("hermes.chatLayoutMenu")}
                title={t("hermes.chatLayoutMenu")}
                aria-expanded={layoutMenuOpen}
              >
                <PanelRight className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
              </Button>

              {layoutMenuOpen && (
                <div className="absolute right-0 top-8 z-50 w-56 rounded-xl border border-sky-400/25 bg-slate-950/95 backdrop-blur-xl shadow-2xl p-2.5 flex flex-col gap-3">
                  <div className="space-y-1.5">
                    <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("hermes.chatDockLabel")}
                    </p>
                    <div className="grid grid-cols-3 gap-1">
                      {(["left", "right", "center"] as const).map((dock) => (
                        <button
                          key={dock}
                          type="button"
                          data-testid={`aura-dock-${dock}`}
                          onClick={() => {
                            updateChatLayout({ dock });
                            setLayoutMenuOpen(false);
                          }}
                          aria-pressed={chatLayout.dock === dock}
                          className={`rounded-lg px-2 py-1.5 text-[11px] transition-colors ${
                            chatLayout.dock === dock
                              ? "bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40"
                              : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                          }`}
                        >
                          {t(`hermes.chatDock.${dock}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("hermes.chatTransparencyLabel")}
                    </p>
                    <div className="grid grid-cols-3 gap-1">
                      {(["clear", "balanced", "solid"] as const).map((level) => (
                        <button
                          key={level}
                          type="button"
                          data-testid={`aura-transparency-${level}`}
                          onClick={() => {
                            updateChatLayout({ transparency: level });
                            setLayoutMenuOpen(false);
                          }}
                          aria-pressed={chatLayout.transparency === level}
                          className={`rounded-lg px-2 py-1.5 text-[11px] transition-colors ${
                            chatLayout.transparency === level
                              ? "bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40"
                              : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                          }`}
                        >
                          {t(`hermes.chatTransparency.${level}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setVoiceSettingsOpen(true)}
              className="h-7 px-2 text-[11px] text-slate-300 hover:text-white rounded-full"
              aria-label={t("hermes.openVoiceSettings")}
              title={t("hermes.openVoiceSettings")}
            >
              <Volume2 className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setMessages([]);
                void aiApi?.chatClear?.(activeSessionId).catch(() => {});
              }}
              className="h-7 shrink-0 rounded-full px-2 text-[11px] text-slate-300 hover:text-white"
              aria-label={t("hermes.clearChat")}
              title={t("hermes.clearChat")}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">{t("hermes.clearChat")}</span>
            </Button>

            {showTranscript && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowTranscript(false)}
                className="h-7 shrink-0 rounded-full px-2 text-[11px] text-slate-300 hover:text-white"
                aria-label={t("hermes.voice.hideTranscript")}
                title={t("hermes.voice.hideTranscript")}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden lg:inline">
                  {t("hermes.voice.hideTranscript")}
                </span>
              </Button>
            )}
          </div>
        </div>

        {/* Full-Height Messages Stream */}
        {showTranscript && (
          <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            ref={transcriptRef}
            data-testid="aura-transcript"
            onScroll={handleTranscriptScroll}
            className={`flex-1 overflow-y-auto space-y-4 p-4 min-h-0 ${transparency.transcript}`}
          >
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="space-y-1.5">
                  <Sparkles className="mx-auto h-7 w-7 text-sky-400/60" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-200">
                    {t("hermes.chatEmptyTitle")}
                  </p>
                  <p className="mx-auto max-w-sm text-xs leading-relaxed text-slate-400">
                    {t("hermes.chatEmptyHint")}
                  </p>
                </div>

                {/* Real starting points — each one fills the composer. */}
                <div className="flex max-w-md flex-wrap justify-center gap-1.5">
                  {(
                    [
                      { id: "summary", label: t("hermes.suggestions.summary") },
                      { id: "pending", label: t("hermes.suggestions.pending") },
                      { id: "memory", label: t("hermes.suggestions.memory") },
                      { id: "task", label: t("hermes.suggestions.task") },
                    ] as const
                  ).map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      data-testid={`aura-suggestion-${suggestion.id}`}
                      onClick={() => setPrompt(t(`hermes.suggestionPrompts.${suggestion.id}`))}
                      className="rounded-full border border-sky-400/25 bg-slate-950/60 px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-sky-400/60 hover:bg-sky-500/10 hover:text-sky-200"
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === "user";
                const parsed = !isUser ? parseAuraMessageThought(msg.text) : null;
                const isLastAssistant =
                  !isUser &&
                  !msg.streaming &&
                  messages[messages.length - 1]?.id === msg.id;
                return (
                  <div
                    key={msg.id}
                    className={`group/message relative flex w-full gap-2.5 ${
                      isUser ? "flex-row-reverse" : ""
                    }`}
                  >
                    {/* Avatar rail — a quieter hierarchy than a filled label. */}
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                        isUser
                          ? "border-sky-400/40 bg-sky-500/15 text-sky-300"
                          : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      }`}
                    >
                      {isUser ? t("hermes.userRole").charAt(0) : "A"}
                    </span>

                    <div
                      className={`min-w-0 space-y-1 ${
                        isUser ? "flex max-w-[85%] flex-col items-end" : "max-w-[92%] flex-1"
                      }`}
                    >
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                          isUser
                            ? "rounded-tr-md border border-sky-400/25 bg-sky-500/12 text-slate-100"
                            : "rounded-tl-md border border-aura-border/30 bg-aura-surface/45 text-slate-100"
                        }`}
                      >
                        {msg.streaming && !isUser && (
                          <span className="mb-1.5 flex items-center gap-1.5 text-[10px] text-amber-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                            {t("hermes.thoughtThinking")}
                          </span>
                        )}

                        {isUser ? (
                          editingMessageId === msg.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void submitEditedMessage();
                                  }
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelEditingMessage();
                                  }
                                }}
                                rows={Math.min(8, editingText.split("\n").length + 1)}
                                autoFocus
                                aria-label={t("hermes.editMessage")}
                                className="w-full resize-y rounded-xl border border-sky-400/40 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60"
                              />
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={cancelEditingMessage}
                                  className="h-6 rounded-full px-2.5 text-[11px]"
                                >
                                  {t("common.cancel", { defaultValue: "Cancel" })}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="primary"
                                  onClick={() => void submitEditedMessage()}
                                  disabled={!editingText.trim()}
                                  className="h-6 rounded-full px-3 text-[11px]"
                                >
                                  <Send className="h-3 w-3" aria-hidden="true" />
                                  <span>{t("hermes.resend")}</span>
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap select-text">
                              {msg.text}
                            </p>
                          )
                        ) : (
                          <>
                            {parsed?.thought && (
                              <AuraThoughtBlock
                                thought={parsed.thought}
                                isThinking={parsed.isThinking}
                              />
                            )}
                            <AuraMarkdownView content={parsed?.answer || msg.text} />
                          </>
                        )}
                      </div>

                      {/* Actions and time live below the bubble, not inside it. */}
                      {editingMessageId !== msg.id && (
                        <div
                          className={`flex items-center gap-2 px-1 text-[10px] text-slate-500 transition-opacity ${
                            isUser
                              ? "justify-end"
                              : "justify-start opacity-0 group-hover/message:opacity-100 focus-within:opacity-100"
                          }`}
                        >
                          {isUser ? (
                            <button
                              type="button"
                              onClick={() => startEditingMessage(msg.id, msg.text)}
                              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-slate-800 hover:text-sky-300 transition-colors"
                              aria-label={t("hermes.editMessage")}
                              title={t("hermes.editMessage")}
                            >
                              <Pencil className="h-3 w-3" aria-hidden="true" />
                              <span>{t("hermes.editMessage")}</span>
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSpeakMessage(parsed?.answer || msg.text)}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-slate-800 hover:text-sky-300 transition-colors"
                                aria-label={t("hermes.speakMessage")}
                                title={t("hermes.speakMessage")}
                              >
                                <Volume2 className="h-3 w-3" aria-hidden="true" />
                                <span>{t("hermes.speakMessage")}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCopyMessage(parsed?.answer || msg.text, msg.id)}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-slate-800 hover:text-sky-300 transition-colors"
                                aria-label={t("hermes.copyMessage")}
                                title={t("hermes.copyMessage")}
                              >
                                {copiedMsgId === msg.id ? (
                                  <>
                                    <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                                    <span className="text-emerald-400">{t("hermes.copied")}</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" aria-hidden="true" />
                                    <span>{t("hermes.copyMessage")}</span>
                                  </>
                                )}
                              </button>
                              {isLastAssistant && (
                                <button
                                  type="button"
                                  onClick={() => void regenerateLastAnswer()}
                                  disabled={sending}
                                  className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-slate-800 hover:text-sky-300 transition-colors disabled:opacity-40"
                                  aria-label={t("hermes.regenerate")}
                                  title={t("hermes.regenerate")}
                                >
                                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                                  <span>{t("hermes.regenerate")}</span>
                                </button>
                              )}
                            </>
                          )}
                          {msg.createdAt && (
                            <time
                              dateTime={msg.createdAt}
                              className="tabular-nums opacity-70"
                            >
                              {formatMessageTime(msg.createdAt)}
                            </time>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Jump back to the newest message when the user scrolled up. */}
          {!atBottom && (
            <button
              type="button"
              onClick={scrollToLatest}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-sky-400/35 bg-slate-950/90 px-3 py-1 text-[11px] text-sky-200 shadow-lg backdrop-blur-md hover:bg-sky-500/20 transition-colors"
              aria-label={t("hermes.jumpToLatest")}
              title={t("hermes.jumpToLatest")}
            >
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
              <span>{t("hermes.jumpToLatest")}</span>
            </button>
          )}
          </div>
        )}

        {!showTranscript && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-slate-400 space-y-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowTranscript(true)}
              className="rounded-full px-4 text-xs"
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              <span>{t("hermes.voice.showTranscript", { defaultValue: "Show chat" })}</span>
            </Button>
          </div>
        )}

        {/* Bottom Dock inside Right Panel */}
        <div className="border-t border-sky-400/20 bg-slate-950/85 p-3 space-y-2 shrink-0">
          {/* Quick Prompt Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPrompt(`${t("hermes.quickActions.createTask")}: `)}
              className="aura-galaxy-chip h-6 rounded-full backdrop-blur-md px-2.5 text-[11px]"
            >
              {t("hermes.quickActions.createTask")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPrompt(`${t("hermes.quickActions.createReminder")}: `)}
              className="aura-galaxy-chip h-6 rounded-full backdrop-blur-md px-2.5 text-[11px]"
            >
              {t("hermes.quickActions.createReminder")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void sendPrompt("summary")}
              className="aura-galaxy-chip h-6 rounded-full backdrop-blur-md px-2.5 text-[11px]"
            >
              {t("hermes.quickActions.summary")}
            </Button>
          </div>

          {/* Status / feedback banners */}
          {feedback && (
            <div
              role="status"
              className="rounded-full border border-emerald-400/35 bg-slate-950/75 px-3 py-1 text-[11px] text-emerald-300 text-center"
            >
              {feedback}
            </div>
          )}
          {voiceBanner && (
            <div
              role="status"
              className="rounded-full border border-sky-400/35 bg-slate-950/75 px-3 py-1 text-[11px] text-sky-200 text-center break-all"
            >
              {voiceBanner}
            </div>
          )}
          {errorMsg && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-xl border border-rose-400/40 bg-slate-950/85 px-3 py-2 text-[11px] text-rose-300"
            >
              <span className="min-w-0 break-words">{errorMsg}</span>
              {/* An error the reader can act on, not just a notice. */}
              <div className="flex shrink-0 items-center gap-1">
                {lastPromptRef.current && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void sendPromptRef.current(lastPromptRef.current ?? undefined)}
                    className="h-6 rounded-full px-2.5 text-[11px] text-rose-200 hover:bg-rose-500/15"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    <span>{t("hermes.retry")}</span>
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setErrorMsg(null)}
                  aria-label={t("hermes.dismissError")}
                  className="h-6 w-6 rounded-full p-0 text-rose-300 hover:bg-rose-500/15"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}

          {/* Input Capsule */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-1.5 rounded-2xl border border-sky-400/30 bg-slate-900/80 p-1.5"
          >
            <Button
              type="button"
              size="sm"
              variant={liveMode ? "danger" : "secondary"}
              aria-pressed={liveMode}
              onClick={() => void toggleLiveMode()}
              className="rounded-xl h-8 px-2.5 shrink-0"
            >
              {liveMode ? (
                <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
              ) : (
                <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="text-[11px]">
                {liveMode ? t("hermes.voice.liveModeOn") : t("hermes.voice.liveModeOff")}
              </span>
            </Button>

            {/* Tone reading of the last utterance (prosody + emotion model). */}
            {liveTone && (
              <span
                className="hidden shrink-0 items-center gap-1 rounded-xl border border-sky-400/25 bg-sky-500/10 px-2 text-[10px] text-sky-200 sm:inline-flex"
                title={`${t("hermes.toneTooltip")}: ${liveTone.meanPitchHz.toFixed(0)} Hz · ${liveTone.speechRate.toFixed(1)} syll/s · ${liveTone.meanLoudnessDb.toFixed(1)} dB`}
              >
                <Activity className="h-3 w-3" aria-hidden="true" />
                <span>{liveTone.label}</span>
                <span className="text-sky-400/70">
                  {liveTone.arousal >= 0 ? "▲" : "▼"}
                </span>
              </span>
            )}

            <Button
              type="button"
              size="sm"
              variant={recording || transcribing ? "danger" : "secondary"}
              loading={savingAudio}
              aria-pressed={recording || transcribing}
              onClick={() => void handleTranscribeOrVoiceClick()}
              className="rounded-xl h-8 px-2.5 shrink-0"
            >
              {recording ? (
                <>
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="text-[11px]">{t("hermes.voice.stopAndSave")}</span>
                </>
              ) : savingAudio ? (
                <span className="text-[11px]">{t("hermes.voice.saving")}</span>
              ) : transcribing ? (
                <>
                  <Mic className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                  <span className="text-[11px]">{t("hermes.voice.transcribing")}</span>
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="text-[11px]">{t("hermes.voice.transcribeAudio")}</span>
                </>
              )}
            </Button>

            <Input
              containerClassName="flex-1 min-w-[120px]"
              className="border-0 bg-transparent px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:ring-0"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("hermes.chatPlaceholder")}
              aria-label={t("hermes.chatTitle")}
            />

            {/* While a reply is streaming the same slot becomes the stop
                control, the way it works in every other assistant. */}
            {sending ? (
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => void stopGeneration()}
                className="rounded-xl h-8 px-3 shrink-0"
                aria-label={t("hermes.stopGenerating")}
                title={t("hermes.stopGenerating")}
              >
                <Square className="h-3 w-3" aria-hidden="true" />
                <span className="text-[11px]">{t("hermes.stopGenerating")}</span>
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                disabled={!prompt.trim()}
                className="rounded-xl h-8 px-3 shrink-0"
              >
                <Send className="h-3 w-3" aria-hidden="true" />
                <span className="text-[11px]">{t("hermes.sendButton")}</span>
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

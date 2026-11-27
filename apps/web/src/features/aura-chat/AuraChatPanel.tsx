import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AudioLines,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FolderOpen,
  Info,
  Layers,
  MessageSquare,
  Mic,
  PanelLeft,
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
  VolumeX,
  X,
} from "lucide-react";

import type { ChatSession } from "../../lib/auraTypes";

import { AuraPyramidStation } from "../../components/AuraPyramidStation";
import { Badge, Button, Input, Switch } from "../../components/ui";
import {
  aiApi,
  audioApi,
  contextEngineApi,
  desktopApi,
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
import { encodePcm16Wav, encodePcm16WavBase64 } from "../../lib/wav";
import { AuraMarkdownView } from "./AuraMarkdownView";
import { AuraThoughtBlock } from "./AuraThoughtBlock";
import { parseAuraMessageThought } from "./auraThoughtParser";
import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  saveVoiceSettings,
  speakAuraUtterance,
  stopAuraSpeech,
  type AuraVoiceSettings,
} from "./auraVoiceEngine";
import { AuraAudioPlayer } from "./auraAudioPlayer";
import { AuraSpeechQueue } from "./auraSpeechQueue";
import { probeAuraVoiceService } from "./auraVoiceService";
import { AuraLiveVoiceSession } from "./auraLiveVoice";
import {
  AuraLiveTranscriber,
  probeAuraSttService,
  transcribeAuraAudio,
  warmAuraSttService,
} from "./auraSpeechToText";
import {
  chatPanelWidthClass,
  chatSideOverlayInsetPx,
  chatTransparencyClasses,
  loadChatLayout,
  saveChatLayout,
  type AuraChatLayoutSettings,
} from "./auraChatLayout";
import type { AuraToneAnalysis } from "./auraToneAnalyzer";
import { AuraVoiceSettingsModal } from "./AuraVoiceSettingsModal";
import { AuraChatSidebar, type CreateProjectPayload } from "./AuraChatSidebar";
import {
  assignSessionToProject,
  createChatProject,
  deleteChatProject,
  loadChatProjects,
  saveChatProjects,
  type AuraChatProject,
  type AuraChatProjectsState,
} from "./auraChatProjects";

const SIDEBAR_OPEN_STORAGE_KEY = "auradesk_chat_sidebar_open";

function loadInitialSidebarOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage?.getItem(SIDEBAR_OPEN_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // ignore storage read errors
  }
  return window.innerWidth >= 1100;
}

function isGenericSessionTitle(title: string | undefined | null): boolean {
  const clean = (title ?? "").trim();
  if (!clean) return true;
  if (
    clean === "Aura Main Session" ||
    clean === "sessions.defaultTitle" ||
    clean === "sessions.newTitle" ||
    clean === "sessions.untitledSession" ||
    clean === "default"
  ) {
    return true;
  }
  return /^(session|sess[aã]o|nova conversa|new chat|aura session|aura-\d{4}-\d{2}-\d{2}|chat)\b/i.test(
    clean
  );
}

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

/** Maps low-level STT/TTS technical errors to localized UI strings. */
function localizeVoiceError(
  error: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("connection timed out")) {
    return t("hermes.voice.connectionTimedOut");
  }
  if (lower.includes("connection failed")) {
    return t("hermes.voice.connectionFailed");
  }
  if (lower.includes("socket error")) {
    return t("hermes.voice.socketError");
  }
  if (lower.startsWith("transcription error")) {
    return t("hermes.voice.transcriptionHttpError", {
      detail: msg.replace(/^transcription error\s*/i, "").trim() || msg,
    });
  }
  if (lower.startsWith("voice service error")) {
    return t("hermes.voice.voiceHttpError", {
      detail: msg.replace(/^voice service error\s*/i, "").trim() || msg,
    });
  }
  return msg || t("hermes.voice.failed");
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
  liveToggleSeq?: number;
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
  liveToggleSeq,
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
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(loadInitialSidebarOpen);
  const setSidebarOpenPersisted = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setSidebarOpen((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      try {
        window.localStorage?.setItem(SIDEBAR_OPEN_STORAGE_KEY, resolved ? "1" : "0");
      } catch {
        // ignore storage write errors
      }
      return resolved;
    });
  }, []);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [projectsState, setProjectsState] = useState<AuraChatProjectsState>(loadChatProjects);
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(null);
  const [raglightStatus, setRaglightStatus] = useState<RaglightStatus | null>(null);
  const historyLoadedRef = useRef(false);
  const [useCli, setUseCli] = useState(false);
  const [prompt, setPrompt] = useState("");
  // The prompts already sent in this session, so ↑/↓ can walk through them.
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const historyIndexRef = useRef<number | null>(null);
  const historyDraftRef = useRef("");
  /**
   * The exact text the history just put in the field.
   *
   * React does not fire `onChange` for a value it sets itself, so the field
   * compares what it receives against this to tell a recall apart from a
   * keystroke by the reader.
   */
  const historyProgrammaticRef = useRef<string | null>(null);
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
  const [liveConnecting, setLiveConnecting] = useState(false);
  const [liveSpeaking, setLiveSpeaking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<AuraVoiceSettings>(loadVoiceSettings);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  // Neural voice (local Kokoro service). `voiceServiceReady` gates the
  // engine: when the container is not running we fall back to the browser
  // `SpeechSynthesis` engine instead of going silent.
  const [voiceServiceReady, setVoiceServiceReady] = useState(false);
  const [sttServiceReady, setSttServiceReady] = useState(false);
  const [voiceProbeDone, setVoiceProbeDone] = useState(false);
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
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const recordingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveModeRef = useRef(false);
  const liveConnectingRef = useRef(false);
  const dictationTranscriberRef = useRef<AuraLiveTranscriber | null>(null);
  const dictationActiveRef = useRef(false);
  const dictationConnectingRef = useRef(false);
  const dictationPrefixRef = useRef("");
  const dictationHadTextRef = useRef(false);
  const sttWarmedRef = useRef(false);
  const handledLiveToggleSeqRef = useRef(0);
  const toggleLiveModeRef = useRef<() => Promise<void>>(async () => {});
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
  const effectiveServiceVoice =
    !speechLang.startsWith("pt") &&
    voiceSettings.serviceVoice === DEFAULT_VOICE_SETTINGS.serviceVoice
      ? "af_heart"
      : voiceSettings.serviceVoice;

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
    if (mountedRef.current) {
      setLiveSpeaking(false);
      setSpeakingMsgId(null);
    }
  }, []);

  useEffect(() => {
    liveVoiceRef.current?.setPaused(liveSpeaking);
    if (!liveSpeaking) {
      setSpeakingMsgId(null);
    }
  }, [liveSpeaking]);

  const toggleAutoSpeak = useCallback(() => {
    const nextEnabled = !voiceSettings.autoSpeak;
    const next = { ...voiceSettings, autoSpeak: nextEnabled };
    setVoiceSettings(next);
    saveVoiceSettings(next);
    if (!nextEnabled) {
      stopSpeechSynthesis();
    }
  }, [stopSpeechSynthesis, voiceSettings]);

  /**
   * True when the local neural voice can be used: the user picked the
   * neural engine, the container is up, and auto-speak is on (auto-speak is
   * bypassed in live conversation mode).
   */
  const canUseNeuralVoice = useCallback(
    (force = false) =>
      voiceSettings.engine === "neural" &&
      voiceServiceReady &&
      (force || liveModeRef.current || voiceSettings.autoSpeak),
    [voiceSettings, voiceServiceReady]
  );

  /**
   * Returns the speech queue for the current voice settings, creating it on
   * first use. The queue synthesizes sentence by sentence so the reply is
   * audible while it is still being written.
   */
  const ensureSpeechQueue = useCallback(
    (force = false): AuraSpeechQueue | null => {
      if (!canUseNeuralVoice(force)) return null;
    const player = voicePlayerRef.current;
    if (!player) return null;

    const queue = speechQueueRef.current;
    if (queue) return queue;

    const created = new AuraSpeechQueue({
      voice: effectiveServiceVoice,
      speed: voiceSettings.speed,
      player,
      onStateChange: (state) => {
        if (mountedRef.current) setLiveSpeaking(state === "speaking");
      },
      onError: (error) => {
        if (mountedRef.current) setErrorMsg(localizeVoiceError(error, t));
      },
    });
    speechQueueRef.current = created;
    return created;
  }, [canUseNeuralVoice, effectiveServiceVoice, t, voiceSettings.speed]);

  // Rebuild the queue when the voice, rate, or UI language changes.
  useEffect(() => {
    speechQueueRef.current?.reset();
    speechQueueRef.current = null;
  }, [effectiveServiceVoice, voiceSettings.speed, voiceSettings.engine]);

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
      setVoiceProbeDone(true);
      if (stt && !sttWarmedRef.current) {
        sttWarmedRef.current = true;
        void warmAuraSttService();
      }
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
        },
        speechLang
      );
    },
    [ensureSpeechQueue, speechLang, voiceSettings]
  );

  const handleSpeakMessage = useCallback(
    (text: string, msgId?: string) => {
      if (msgId && speakingMsgId === msgId && liveSpeaking) {
        stopSpeechSynthesis();
        return;
      }

      const parsed = parseAuraMessageThought(text);
      const answer = parsed.answer || parsed.thought || "";
      if (!answer.trim()) return;

      stopSpeechSynthesis();
      setSpeakingMsgId(msgId ?? null);

      const queue = ensureSpeechQueue(true);
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
          if (mountedRef.current) {
            setLiveSpeaking(false);
            setSpeakingMsgId(null);
          }
        },
        () => {
          if (mountedRef.current) {
            setLiveSpeaking(false);
            setSpeakingMsgId(null);
          }
        },
        speechLang
      );
    },
    [
      ensureSpeechQueue,
      liveSpeaking,
      speakingMsgId,
      speechLang,
      stopSpeechSynthesis,
      voiceSettings,
    ]
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
        sessionsList,
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
        sessionsApi?.list?.(null, "active")?.catch(() => null) ?? Promise.resolve(null),
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
      if (Array.isArray(sessionsList)) {
        setSessions(sessionsList);
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

  const availableBanks = useMemo(() => {
    const set = new Set<string>(
      Array.isArray(hindsightStatus?.banks) ? hindsightStatus.banks : []
    );
    (galaxySnapshot?.banks ?? []).forEach((b) => {
      if (b.id) set.add(b.id);
    });
    projectsState.projects.forEach((p) => {
      if (p.bankId) set.add(p.bankId);
    });
    return Array.from(set);
  }, [galaxySnapshot?.banks, hindsightStatus?.banks, projectsState.projects]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  const activeSessionDisplayTitle = useMemo(() => {
    if (activeSession && !isGenericSessionTitle(activeSession.title)) {
      return t(activeSession.title, { defaultValue: activeSession.title });
    }
    return t("hermes.chatTitle");
  }, [activeSession, t]);

  const activeSessionProject: AuraChatProject | null = useMemo(() => {
    const pid = projectsState.sessionProjectMap[activeSessionId];
    if (!pid) return null;
    return projectsState.projects.find((p) => p.id === pid) ?? null;
  }, [activeSessionId, projectsState]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (!sessionId) return;
      if (sessionId === activeSessionId) {
        setShowTranscript(true);
        return;
      }
      historyLoadedRef.current = false;
      loadedSessionRef.current = sessionId;
      setInternalSessionId(sessionId);
      onSessionChange?.(sessionId);
      setMessages([]);
      setShowTranscript(true);
    },
    [activeSessionId, onSessionChange]
  );

  const handleNewSession = useCallback(
    async (projectIdOverride?: string | null) => {
      if (creatingSession || !sessionsApi?.create) return;
      setCreatingSession(true);
      setErrorMsg(null);
      try {
        const created = await sessionsApi.create();
        if (!mountedRef.current) return;
        const targetProjectId =
          projectIdOverride !== undefined
            ? projectIdOverride
            : selectedProjectFilter && selectedProjectFilter !== "general"
              ? selectedProjectFilter
              : null;
        if (targetProjectId) {
          setProjectsState((prev) => {
            const next = assignSessionToProject(prev, created.id, targetProjectId);
            saveChatProjects(next);
            return next;
          });
        }
        historyLoadedRef.current = true;
        loadedSessionRef.current = created.id;
        setInternalSessionId(created.id);
        onSessionChange?.(created.id);
        setMessages([]);
        setShowTranscript(true);
        setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
        setFeedback(
          t("hermes.sessionBadge", { title: t(created.title, { defaultValue: created.title }) })
        );
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
    },
    [creatingSession, onSessionChange, selectedProjectFilter, t]
  );

  const handleCreateProject = useCallback(
    async (payload: CreateProjectPayload) => {
      let resolvedBankId = payload.bankId;
      if (payload.bankMode === "create" && resolvedBankId) {
        await hindsightExploreApi
          ?.bankCreate?.({
            bankId: resolvedBankId,
            name: payload.name,
            mission: payload.contextNote || null,
          })
          .catch(() => null);
      }
      let createdProjectId = "";
      setProjectsState((prev) => {
        const { state: next, project } = createChatProject(prev, {
          name: payload.name,
          bankId: resolvedBankId,
          contextNote: payload.contextNote,
        });
        createdProjectId = project.id;
        saveChatProjects(next);
        return next;
      });
      if (createdProjectId) {
        setSelectedProjectFilter(createdProjectId);
      }
      if (payload.bankMode === "create" && resolvedBankId) {
        void loadData();
      }
    },
    [loadData]
  );

  const handleDeleteProject = useCallback((projectId: string) => {
    setProjectsState((prev) => {
      const next = deleteChatProject(prev, projectId);
      saveChatProjects(next);
      return next;
    });
    setSelectedProjectFilter((prev) => (prev === projectId ? null : prev));
  }, []);

  const handleAssignSessionProject = useCallback(
    (sessionId: string, projectId: string | null) => {
      setProjectsState((prev) => {
        const next = assignSessionToProject(prev, sessionId, projectId);
        saveChatProjects(next);
        return next;
      });
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadData();

    if (!isTauriRuntime()) {
      return () => {
        mountedRef.current = false;
        liveModeRef.current = false;
        recordingRef.current = false;
        dictationActiveRef.current = false;
        liveChunkSinkRef.current = null;
        dictationTranscriberRef.current?.close();
        dictationTranscriberRef.current = null;
        void liveVoiceRef.current?.stop();
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
      dictationActiveRef.current = false;
      liveChunkSinkRef.current = null;
      dictationTranscriberRef.current?.close();
      dictationTranscriberRef.current = null;
      void liveVoiceRef.current?.stop();
      stopSpeechRecognition();
      stopSpeechSynthesis();
      stopAudioTracks();
      unlisteners.forEach((fn) => fn());
    };
  }, [loadData, stopAudioTracks, stopSpeechRecognition, stopSpeechSynthesis]);

  useEffect(() => {
    if ((transcribing || liveMode) && promptInputRef.current) {
      promptInputRef.current.scrollLeft = promptInputRef.current.scrollWidth;
    }
  }, [prompt, transcribing, liveMode]);

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
      setPromptHistory((prev) => (prev[prev.length - 1] === raw ? prev : [...prev, raw]));
      historyIndexRef.current = null;
      historyDraftRef.current = "";
      setSending(true);
      setErrorMsg(null);
      setFeedback(null);
      setShowTranscript(true);
      setPulseTick((c) => c + 1);

      // Fire background Hindsight recall + optional RAGLight query immediately to light up 3D pulses
      const scopedBankId = activeSessionProject?.bankId ?? null;
      void Promise.all([
        hindsightApi?.recall?.(raw, scopedBankId, 24)?.catch(() => null) ??
          Promise.resolve(null),
        raglightStatus?.enabled
          ? raglightApi?.query?.(raw, 4)?.catch(() => null) ?? Promise.resolve(null)
          : Promise.resolve(null),
      ]).then(([recalled]) => {
        if (!mountedRef.current) return;
        if (Array.isArray(recalled) && recalled.length > 0) {
          setHindsightMemories([...recalled]);
        }
      });

      const isFirstTurn = messages.length === 0;
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
        if (
          isFirstTurn &&
          activeSessionId !== "default" &&
          isGenericSessionTitle(activeSession?.title) &&
          sessionsApi?.rename
        ) {
          const compactRaw = raw.replace(/\s+/g, " ").trim();
          const autoTitle =
            compactRaw.length > 44 ? `${compactRaw.slice(0, 44).trimEnd()}…` : compactRaw;
          if (autoTitle) {
            await sessionsApi.rename(activeSessionId, autoTitle).catch(() => null);
          }
        }
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
        if (
          (liveModeRef.current || voiceSettings.autoSpeak) &&
          !reply.streaming &&
          reply.replyText
        ) {
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
      activeSession?.title,
      activeSessionId,
      activeSessionProject?.bankId,
      loadData,
      messages.length,
      prompt,
      raglightStatus?.enabled,
      speakReply,
      status.available,
      useCli,
      voiceSettings.autoSpeak,
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
    if (dictationActiveRef.current) {
      void stopLiveDictation(false);
    }
    void sendPrompt();
  };

  /**
   * Walks the prompt history with ↑/↓, the way a shell does it.
   *
   * ↑ goes back to the previous prompt, ↓ walks forward again and the last
   * ↓ restores whatever was being typed before the first ↑.
   */
  const handlePromptKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const list = promptHistory;
      if (list.length === 0) return;
      event.preventDefault();

      const current = historyIndexRef.current;
      if (event.key === "ArrowUp") {
        if (current === null) {
          historyDraftRef.current = prompt;
          const next = list.length - 1;
          historyIndexRef.current = next;
          historyProgrammaticRef.current = list[next];
          setPrompt(list[next]);
        } else if (current > 0) {
          const next = current - 1;
          historyIndexRef.current = next;
          historyProgrammaticRef.current = list[next];
          setPrompt(list[next]);
        }
        return;
      }

      if (current === null) return;
      if (current < list.length - 1) {
        const next = current + 1;
        historyIndexRef.current = next;
        historyProgrammaticRef.current = list[next];
        setPrompt(list[next]);
      } else {
        historyIndexRef.current = null;
        historyProgrammaticRef.current = historyDraftRef.current;
        setPrompt(historyDraftRef.current);
      }
    },
    [prompt, promptHistory]
  );

  const stopAndSaveWavCapture = useCallback(
    async (options?: { skipTranscribe?: boolean }) => {
      const sampleRate = audioCtxRef.current?.sampleRate ?? 16_000;
      const chunks = pcmChunksRef.current;
      pcmChunksRef.current = [];
      stopAudioTracks();
      recordingRef.current = false;
      setRecording(false);

      if (options?.skipTranscribe) {
        return;
      }

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      setSavingAudio(true);
      setVoiceBanner(null);

      try {
        if (sttServiceReady && merged.length > 0) {
          const wavBytes = encodePcm16Wav(merged, sampleRate);
          const result = await transcribeAuraAudio(wavBytes, {
            language: speechLang.startsWith("pt") ? "pt" : "en",
          });
          if (!mountedRef.current) return;
          if (result.text) {
            setPrompt((prev) => (prev.trim() ? `${prev.trim()} ${result.text}` : result.text));
          }
          return;
        }
        const b64 = encodePcm16WavBase64(chunks, sampleRate);
        const saved = await audioApi.saveVoiceCapture(b64, "hermes-voice");
        if (!mountedRef.current) return;
        setVoiceBanner(t("hermes.voice.saved", { bytes: saved.bytes, path: saved.filePath }));
      } catch (err) {
        if (!mountedRef.current) return;
        setErrorMsg(localizeVoiceError(err, t));
      } finally {
        if (mountedRef.current) setSavingAudio(false);
      }
    },
    [speechLang, stopAudioTracks, sttServiceReady, t]
  );

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
        if (
          "state" in ctx &&
          ctx.state === "suspended" &&
          typeof ctx.resume === "function"
        ) {
          await ctx.resume();
        }
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

  const stopLiveDictation = useCallback(
    async (fallbackTranscribeIfEmpty = false) => {
      liveChunkSinkRef.current = null;
      const transcriber = dictationTranscriberRef.current;
      dictationTranscriberRef.current = null;
      transcriber?.close();
      dictationActiveRef.current = false;
      if (mountedRef.current) {
        setTranscribing(false);
      }
      if (recordingRef.current) {
        if (fallbackTranscribeIfEmpty && !dictationHadTextRef.current) {
          await stopAndSaveWavCapture();
        } else {
          await stopAndSaveWavCapture({ skipTranscribe: true });
        }
      }
    },
    [stopAndSaveWavCapture]
  );

  const toggleLiveMode = useCallback(async () => {
    if (liveConnectingRef.current) return;

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
        await stopAndSaveWavCapture({ skipTranscribe: true });
      }
      return;
    }

    if (dictationActiveRef.current) {
      await stopLiveDictation(false);
    } else {
      if (transcribing) {
        setTranscribing(false);
        stopSpeechRecognition();
      }
      if (recordingRef.current) {
        await stopAndSaveWavCapture();
      }
    }

    setErrorMsg(null);
    setVoiceBanner(null);
    setLiveTone(null);

    // Preferred path: the local Whisper service transcribes in the active
    // UI language with real incremental results. The browser Web Speech API
    // is only used when the local service is unavailable.
    if (sttServiceReady) {
      liveConnectingRef.current = true;
      setLiveConnecting(true);
      setVoiceBanner(t("hermes.voice.connectingLive"));
      try {
        const captured = await startWavCapture(true);
        if (!captured) {
          setVoiceBanner(null);
          setErrorMsg(t("hermes.voice.failed"));
          return;
        }

        const session = new AuraLiveVoiceSession({
          language: speechLang.startsWith("pt") ? "pt" : "en",
          sampleRate: audioCtxRef.current?.sampleRate ?? 48_000,
          onInterim: (text) => {
            if (mountedRef.current) {
              setPrompt(text.replace(/\s+/g, " ").trim());
            }
          },
          onFinal: (text) => {
            const clean = text.replace(/\s+/g, " ").trim();
            if (!mountedRef.current || !clean) return;
            setPrompt("");
            void sendPromptRef.current(clean);
          },
          onTone: (analysis) => {
            if (mountedRef.current) setLiveTone(analysis);
          },
          onError: (error) => {
            if (mountedRef.current) setErrorMsg(localizeVoiceError(error, t));
          },
        });

        const started = await session.start();
        if (!mountedRef.current) {
          await session.stop();
          await stopAndSaveWavCapture({ skipTranscribe: true });
          return;
        }
        if (started) {
          setVoiceBanner(null);
          liveVoiceRef.current = session;
          liveModeRef.current = true;
          setLiveMode(true);
          const rate = audioCtxRef.current?.sampleRate ?? 48_000;
          liveChunkSinkRef.current = (chunk) => session.push(chunk, rate);
          return;
        }

        setVoiceBanner(null);
        await stopAndSaveWavCapture({ skipTranscribe: true });
        return;
      } finally {
        liveConnectingRef.current = false;
        if (mountedRef.current) setLiveConnecting(false);
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
    stopLiveDictation,
    stopSpeechRecognition,
    stopSpeechSynthesis,
    sttServiceReady,
    t,
    transcribing,
  ]);

  useEffect(() => {
    toggleLiveModeRef.current = toggleLiveMode;
  }, [toggleLiveMode]);

  useEffect(() => {
    if (!liveToggleSeq || !voiceProbeDone) return;
    if (liveToggleSeq <= handledLiveToggleSeqRef.current) return;
    handledLiveToggleSeqRef.current = liveToggleSeq;
    void toggleLiveModeRef.current();
  }, [liveToggleSeq, voiceProbeDone]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void desktopApi.setTrayLiveVoice(liveMode).catch(() => {});
  }, [liveMode]);

  useEffect(() => {
    return () => {
      if (isTauriRuntime() && liveModeRef.current) {
        void desktopApi.setTrayLiveVoice(false).catch(() => {});
      }
    };
  }, []);

  const handleTranscribeOrVoiceClick = useCallback(async () => {
    if (dictationConnectingRef.current) return;

    if (dictationActiveRef.current) {
      await stopLiveDictation(true);
      return;
    }
    if (recordingRef.current && !liveModeRef.current) {
      await stopAndSaveWavCapture();
      return;
    }
    if (transcribing) {
      setTranscribing(false);
      stopSpeechRecognition();
      return;
    }

    if (sttServiceReady) {
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
          await stopAndSaveWavCapture({ skipTranscribe: true });
        }
      }

      dictationConnectingRef.current = true;
      dictationPrefixRef.current = prompt.trim();
      dictationHadTextRef.current = false;
      setErrorMsg(null);
      setVoiceBanner(t("hermes.voice.connectingLive"));

      try {
        const captured = await startWavCapture(false);
        if (!captured) {
          setVoiceBanner(null);
          return;
        }

        const transcriber = new AuraLiveTranscriber({
          language: speechLang.startsWith("pt") ? "pt" : "en",
          onText: (text) => {
            const clean = text.replace(/\s+/g, " ").trim();
            if (!clean || !mountedRef.current || !dictationActiveRef.current) return;
            dictationHadTextRef.current = true;
            setPrompt(
              dictationPrefixRef.current ? `${dictationPrefixRef.current} ${clean}` : clean
            );
          },
          onError: (err) => {
            if (mountedRef.current) setErrorMsg(localizeVoiceError(err, t));
          },
          onClose: () => {
            if (dictationActiveRef.current && mountedRef.current) {
              void stopLiveDictation(false);
            }
          },
        });

        try {
          await transcriber.connect();
        } catch (err) {
          if (mountedRef.current) {
            setVoiceBanner(null);
            setErrorMsg(localizeVoiceError(err, t));
          }
          await stopAndSaveWavCapture({ skipTranscribe: true });
          return;
        }

        if (!mountedRef.current) {
          transcriber.close();
          await stopAndSaveWavCapture({ skipTranscribe: true });
          return;
        }

        setVoiceBanner(null);
        dictationTranscriberRef.current = transcriber;
        dictationActiveRef.current = true;
        setTranscribing(true);
        const rate = audioCtxRef.current?.sampleRate ?? 48_000;
        liveChunkSinkRef.current = (chunk) => transcriber.send(chunk, rate);
        return;
      } finally {
        dictationConnectingRef.current = false;
      }
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
    startWavCapture,
    stopAndSaveWavCapture,
    stopLiveDictation,
    stopSpeechRecognition,
    stopSpeechSynthesis,
    sttServiceReady,
    t,
    toggleVoiceCapture,
    transcribing,
  ]);

  const transparency = chatTransparencyClasses(chatLayout.transparency);
  const compactHeader = !showTranscript || chatLayout.size === "compact";
  const sidebarVisible = sidebarOpen && showTranscript;
  const sideInsetPx = showTranscript
    ? chatSideOverlayInsetPx(chatLayout.size, sidebarVisible)
    : 0;
  const hudInsetLeftPx = chatLayout.dock === "left" ? sideInsetPx : 0;
  const hudInsetRightPx = chatLayout.dock === "right" ? sideInsetPx : 0;
  const panelWidthClass = chatPanelWidthClass(
    chatLayout.dock,
    chatLayout.size,
    sidebarVisible
  );

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
    <div className="relative flex-1 h-full w-full min-h-0 flex flex-col lg:flex-row overflow-hidden">
      {/* Voice Settings Modal */}
      <AuraVoiceSettingsModal
        open={voiceSettingsOpen}
        onClose={() => setVoiceSettingsOpen(false)}
        settings={voiceSettings}
        onSettingsChange={setVoiceSettings}
      />

      {/* Main 3D Holographic Pyramid Station & Memory Universe (full-bleed behind floating chat on desktop) */}
      <div
        data-testid="aura-pyramid-stage"
        className={`relative w-full overflow-hidden flex flex-col ${
          chatLayout.dock === "center"
            ? "flex-1 h-full min-h-0 lg:order-1"
            : showTranscript
              ? "flex-none h-[36%] min-h-[220px] max-h-[360px] lg:flex-1 lg:h-full lg:min-h-0 lg:max-h-none lg:order-1"
              : "flex-1 min-h-[240px] lg:h-full lg:min-h-0 lg:order-1"
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
          speaking={liveSpeaking}
          thinking={sending || messages.some((m) => m.streaming)}
          listening={prompt.trim().length > 0 || recording || liveMode || transcribing}
          expanded={pyramidExpanded}
          onExpandedChange={setPyramidExpanded}
          onOpenSettings={onOpenSettings}
          hudInsetLeftPx={hudInsetLeftPx}
          hudInsetRightPx={hudInsetRightPx}
        />

        {/* Floating control: the status chrome lives in this menu.
            Anchored bottom-left: the station's own controls occupy the top
            row of the canvas. */}
        <div
          style={{ "--aura-hud-inset-l": `${hudInsetLeftPx}px` } as CSSProperties}
          className="aura-galaxy-chrome-scope pointer-events-none absolute bottom-2 left-2 lg:bottom-4 lg:left-[calc(1rem+var(--aura-hud-inset-l,0px))] z-10"
        >
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

      {/* Conversation column (floating translucent overlay across left, right, and center on desktop) */}
      <div
        data-testid="aura-chat-panel"
        className={`aura-galaxy-chrome-scope flex flex-row min-h-0 ${transparency.blur} shadow-2xl ${panelWidthClass} ${
          chatLayout.dock === "center"
            ? showTranscript
              ? `absolute inset-x-0 bottom-0 h-[62%] lg:inset-y-0 lg:h-full left-1/2 -translate-x-1/2 z-30 rounded-none border-t lg:border-t-0 border-x ${transparency.border} ${transparency.container}`
              : `absolute inset-x-0 bottom-0 h-auto lg:bottom-4 left-1/2 -translate-x-1/2 z-30 rounded-none lg:rounded-2xl border-t border-x lg:border ${transparency.border} ${transparency.container}`
            : showTranscript
              ? `relative z-20 flex-1 min-h-0 border-t lg:border-t-0 lg:absolute lg:inset-y-0 lg:h-full lg:flex-none lg:z-30 ${
                  chatLayout.dock === "left"
                    ? "lg:left-0 lg:right-auto lg:border-r"
                    : "lg:right-0 lg:left-auto lg:border-l"
                } ${transparency.border} ${transparency.container}`
              : `relative z-20 flex-none h-auto border-t lg:absolute lg:top-auto lg:bottom-4 lg:z-30 lg:rounded-2xl lg:border ${
                  chatLayout.dock === "left"
                    ? "lg:left-4 lg:right-auto"
                    : "lg:right-4 lg:left-auto"
                } ${transparency.border} ${transparency.container}`
        }`}
      >
        {sidebarVisible && (
          <div className="absolute inset-y-0 left-0 z-40 w-[248px] max-w-[86%] lg:static lg:z-auto lg:w-[208px] xl:w-[224px] lg:max-w-none shrink-0 h-full min-h-0 shadow-2xl lg:shadow-none">
            <AuraChatSidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              projectsState={projectsState}
              selectedProjectFilter={selectedProjectFilter}
              onSelectProjectFilter={setSelectedProjectFilter}
              availableBanks={availableBanks}
              creatingSession={creatingSession}
              onSelectSession={handleSelectSession}
              onNewChat={(pid) => void handleNewSession(pid)}
              onCreateProject={handleCreateProject}
              onDeleteProject={handleDeleteProject}
              onAssignSessionProject={handleAssignSessionProject}
              onOpenSessions={onOpenSessions}
              onOpenBank={onOpenHindsightBank}
              onClose={() => setSidebarOpenPersisted(false)}
              surfaceClassName={transparency.header}
              borderClassName={transparency.border}
            />
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Header */}
        <div
          ref={layoutMenuRef}
          className={`relative flex items-center justify-between gap-2 border-b border-sky-400/15 shrink-0 ${
            compactHeader ? "px-3 py-2" : "px-4 py-3"
          } ${transparency.header}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="aura-sessions-sidebar-btn"
              onClick={() => {
                if (!showTranscript) {
                  setShowTranscript(true);
                  setSidebarOpenPersisted(true);
                } else {
                  setSidebarOpenPersisted((v) => !v);
                }
              }}
              aria-pressed={sidebarVisible}
              aria-label={t("hermes.sidebar.toggle")}
              title={t("hermes.sidebar.toggle")}
              className={`h-7 w-7 p-0 shrink-0 rounded-lg ${
                sidebarVisible
                  ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40"
                  : !compactHeader
                    ? "border border-sky-400/20 text-slate-200 hover:bg-sky-500/15 hover:text-white"
                    : "text-slate-300 hover:text-white"
              }`}
            >
              <PanelLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Sparkles className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
            <span className="truncate text-xs font-semibold text-slate-100">
              {activeSessionDisplayTitle}
            </span>
            {messages.length > 0 && (
              <Badge variant="neutral" className="h-4 shrink-0 rounded-full px-1.5 py-0 text-[10px]">
                {messages.length}
              </Badge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Dock position + transparency + size */}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="aura-layout-menu-btn"
              onClick={() => setLayoutMenuOpen((v) => !v)}
              className="h-7 w-7 p-0 text-[11px] text-slate-300 hover:text-white rounded-full"
              aria-label={t("hermes.chatLayoutMenu")}
              title={t("hermes.chatLayoutMenu")}
              aria-expanded={layoutMenuOpen}
            >
              <PanelRight className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setVoiceSettingsOpen(true)}
              className="h-7 w-7 p-0 text-[11px] text-slate-300 hover:text-white rounded-full"
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
              className={
                compactHeader
                  ? "h-7 w-7 p-0 shrink-0 rounded-full text-slate-300 hover:text-white"
                  : "h-7 shrink-0 rounded-full px-2 text-[11px] text-slate-300 hover:text-white"
              }
              aria-label={t("hermes.clearChat")}
              title={t("hermes.clearChat")}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className={compactHeader ? "hidden" : "hidden xl:inline"}>
                {t("hermes.clearChat")}
              </span>
            </Button>

            {showTranscript ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowTranscript(false)}
                className={
                  compactHeader
                    ? "h-7 w-7 p-0 shrink-0 rounded-full text-slate-300 hover:text-white"
                    : "h-7 shrink-0 rounded-full px-2 text-[11px] text-slate-300 hover:text-white"
                }
                aria-label={t("hermes.voice.hideTranscript")}
                title={t("hermes.voice.hideTranscript")}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                <span className={compactHeader ? "hidden" : "hidden xl:inline"}>
                  {t("hermes.voice.hideTranscript")}
                </span>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="aura-show-transcript-btn"
                onClick={() => setShowTranscript(true)}
                className="h-7 w-7 p-0 shrink-0 rounded-full text-sky-300 hover:text-white"
                aria-label={t("hermes.voice.showTranscript")}
                title={t("hermes.voice.showTranscript")}
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden">{t("hermes.voice.showTranscript")}</span>
              </Button>
            )}
          </div>

          {layoutMenuOpen && (
            <div
              data-testid="aura-layout-popover"
              className={`absolute z-50 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-sky-400/25 bg-slate-950/95 backdrop-blur-xl shadow-2xl p-2.5 flex flex-col gap-3 ${
                showTranscript ? "top-11" : "bottom-11"
              } ${chatLayout.dock === "left" ? "left-2" : "right-2"}`}
            >
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

              <div className="space-y-1.5">
                <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("hermes.chatSizeLabel")}
                </p>
                <div className="grid grid-cols-3 gap-1">
                  {(["compact", "normal", "wide"] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      data-testid={`aura-size-${size}`}
                      onClick={() => {
                        updateChatLayout({ size });
                        setLayoutMenuOpen(false);
                      }}
                      aria-pressed={chatLayout.size === size}
                      className={`rounded-lg px-2 py-1.5 text-[11px] transition-colors ${
                        chatLayout.size === size
                          ? "bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40"
                          : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                      }`}
                    >
                      {t(`hermes.chatSize.${size}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Active Project + Linked Bank Pill */}
        {activeSessionProject && showTranscript && (
          <div
            data-testid="aura-active-project-bar"
            className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-sky-400/15 bg-slate-950/35 text-[11px] shrink-0"
          >
            <span className="inline-flex items-center gap-1 text-sky-200 font-medium">
              <FolderOpen className="h-3 w-3 text-sky-400" aria-hidden="true" />
              <span>{activeSessionProject.name}</span>
            </span>
            {activeSessionProject.bankId && (
              <button
                type="button"
                onClick={() => onOpenHindsightBank?.(activeSessionProject.bankId!)}
                className="inline-flex items-center gap-1 rounded-full border border-cyan-400/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20 transition-colors"
              >
                <Brain className="h-2.5 w-2.5" aria-hidden="true" />
                <span>{activeSessionProject.bankId}</span>
              </button>
            )}
            {activeSessionProject.contextNote && (
              <span className="truncate text-[10px] text-slate-400 max-w-[200px]">
                {activeSessionProject.contextNote}
              </span>
            )}
          </div>
        )}

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
                        isUser ? "flex max-w-[85%] flex-col items-end" : "max-w-[88%] flex-1"
                      }`}
                    >
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed break-words ${
                          isUser
                            ? "rounded-tr-md border border-sky-400/30 bg-sky-500/15 text-slate-50 shadow-sm shadow-sky-950/20"
                            : "rounded-tl-md border border-sky-400/15 bg-slate-900/70 text-slate-100 shadow-sm shadow-slate-950/30"
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
                            <p className="whitespace-pre-wrap break-words select-text">
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
                          data-testid="aura-message-actions"
                          className={`flex flex-wrap items-center gap-x-1 gap-y-1 px-0.5 pt-0.5 text-[11px] text-slate-400 transition-opacity ${
                            isUser
                              ? "justify-end"
                              : "justify-start opacity-85 group-hover/message:opacity-100 focus-within:opacity-100"
                          }`}
                        >
                          {isUser ? (
                            <button
                              type="button"
                              onClick={() => startEditingMessage(msg.id, msg.text)}
                              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded-md px-1.5 py-0.5 leading-none hover:bg-slate-800/80 hover:text-sky-300 transition-colors"
                              aria-label={t("hermes.editMessage")}
                              title={t("hermes.editMessage")}
                            >
                              <Pencil className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span>{t("hermes.editMessage")}</span>
                            </button>
                          ) : (
                            <>
                              {(() => {
                                const isMsgSpeaking = speakingMsgId === msg.id && liveSpeaking;
                                return (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSpeakMessage(parsed?.answer || msg.text, msg.id)
                                    }
                                    className={`inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded-md px-1.5 py-0.5 leading-none transition-colors ${
                                      isMsgSpeaking
                                        ? "bg-sky-500/20 text-sky-200"
                                        : "hover:bg-slate-800/80 hover:text-sky-300"
                                    }`}
                                    aria-label={
                                      isMsgSpeaking
                                        ? t("hermes.stopSpeaking")
                                        : t("hermes.speakMessage")
                                    }
                                    title={
                                      isMsgSpeaking
                                        ? t("hermes.stopSpeaking")
                                        : t("hermes.speakMessage")
                                    }
                                  >
                                    {isMsgSpeaking ? (
                                      <>
                                        <Square className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                                        <span>{t("hermes.stopSpeakingShort")}</span>
                                      </>
                                    ) : (
                                      <>
                                        <Volume2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        <span>{t("hermes.speakMessageShort")}</span>
                                      </>
                                    )}
                                  </button>
                                );
                              })()}
                              <button
                                type="button"
                                onClick={() => void handleCopyMessage(parsed?.answer || msg.text, msg.id)}
                                className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded-md px-1.5 py-0.5 leading-none hover:bg-slate-800/80 hover:text-sky-300 transition-colors"
                                aria-label={t("hermes.copyMessage")}
                                title={t("hermes.copyMessage")}
                              >
                                {copiedMsgId === msg.id ? (
                                  <>
                                    <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
                                    <span className="text-emerald-400">{t("hermes.copied")}</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3 shrink-0" aria-hidden="true" />
                                    <span>{t("hermes.copyMessageShort")}</span>
                                  </>
                                )}
                              </button>
                              {isLastAssistant && (
                                <button
                                  type="button"
                                  onClick={() => void regenerateLastAnswer()}
                                  disabled={sending}
                                  className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded-md px-1.5 py-0.5 leading-none hover:bg-slate-800/80 hover:text-sky-300 transition-colors disabled:opacity-40"
                                  aria-label={t("hermes.regenerate")}
                                  title={t("hermes.regenerate")}
                                >
                                  <RefreshCw className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  <span>{t("hermes.regenerateShort")}</span>
                                </button>
                              )}
                            </>
                          )}
                          {msg.createdAt && (
                            <time
                              dateTime={msg.createdAt}
                              className={`${isUser ? "" : "ml-auto "}shrink-0 tabular-nums text-[10px] text-slate-500`}
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

        {/* Bottom Prompt Dock */}
        <div
          data-testid="aura-chat-composer"
          className={`border-t border-sky-400/20 shrink-0 ${
            showTranscript ? "p-3 space-y-2" : "p-2 space-y-1.5"
          } ${transparency.composer}`}
        >
          {/* Quick Prompt Chips (hidden in prompt-only mode) */}
          {showTranscript && (
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
          )}

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

          {/* Input Capsule (2-tier layout) */}
          <form
            onSubmit={handleSubmit}
            className={`rounded-2xl border ${transparency.input} p-2 space-y-2 transition-colors focus-within:border-sky-400/60 ${
              transcribing || liveMode
                ? "border-sky-400/70 shadow-[0_0_0_1px_rgba(56,189,248,0.2)]"
                : "border-sky-400/30"
            }`}
          >
            <Input
              ref={promptInputRef}
              containerClassName="w-full"
              className="border-0 bg-transparent px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 focus-visible:ring-0"
              value={prompt}
              onChange={(e) => {
                // Typing by hand leaves the history — the next ↑ starts over.
                if (historyProgrammaticRef.current !== e.target.value) {
                  historyIndexRef.current = null;
                  historyDraftRef.current = "";
                }
                historyProgrammaticRef.current = null;
                setPrompt(e.target.value);
              }}
              onKeyDown={handlePromptKeyDown}
              placeholder={t("hermes.chatPlaceholder")}
              aria-label={t("hermes.chatTitle")}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-sky-400/15">
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={liveMode ? "danger" : "ghost"}
                  disabled={liveConnecting}
                  aria-pressed={liveMode}
                  aria-label={
                    liveConnecting
                      ? t("hermes.voice.connectingLive")
                      : liveMode
                        ? t("hermes.voice.liveModeOn")
                        : t("hermes.voice.liveModeOff")
                  }
                  title={
                    liveConnecting
                      ? t("hermes.voice.connectingLive")
                      : liveMode
                        ? t("hermes.voice.liveModeOn")
                        : sttServiceReady
                          ? `${t("hermes.voice.liveModeOff")} · Whisper + Kokoro`
                          : t("hermes.voice.liveModeOff")
                  }
                  onClick={() => void toggleLiveMode()}
                  className={
                    liveMode || liveConnecting
                      ? "rounded-lg h-7 px-2.5 shrink-0"
                      : "relative rounded-lg h-7 w-7 p-0 text-slate-400 hover:text-sky-200 hover:bg-slate-800/70 shrink-0"
                  }
                >
                  {liveConnecting ? (
                    <>
                      <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                      <span className="text-[11px]">{t("hermes.voice.connectingLive")}</span>
                    </>
                  ) : liveMode ? (
                    <>
                      <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                      <span className="text-[11px]">{t("hermes.voice.liveModeOn")}</span>
                    </>
                  ) : (
                    <>
                      <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
                      {sttServiceReady && voiceServiceReady && (
                        <span
                          aria-hidden="true"
                          className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-400"
                        />
                      )}
                    </>
                  )}
                </Button>

                {/* Tone reading of the last utterance (prosody + emotion model). */}
                {liveTone && (
                  <span
                    className="hidden shrink-0 items-center gap-1 rounded-xl border border-sky-400/25 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-200 sm:inline-flex"
                    title={`${t("hermes.toneTooltip")}: ${liveTone.meanPitchHz.toFixed(0)} Hz · ${liveTone.speechRate.toFixed(1)} syll/s · ${liveTone.meanLoudnessDb.toFixed(1)} dB`}
                  >
                    <Activity className="h-3 w-3" aria-hidden="true" />
                    <span>{liveTone.label}</span>
                    <span className="text-sky-400/70">
                      {liveTone.arousal >= 0 ? "▲" : "▼"}
                    </span>
                  </span>
                )}

                {(() => {
                  const isWavFallbackRecording =
                    recording && !liveMode && !liveConnecting && !transcribing;
                  const micActive =
                    isWavFallbackRecording || savingAudio || transcribing;
                  return (
                    <Button
                      type="button"
                      size="sm"
                      variant={micActive ? "danger" : "ghost"}
                      loading={savingAudio}
                      aria-pressed={micActive}
                      aria-label={
                        isWavFallbackRecording
                          ? t("hermes.voice.stopAndSave")
                          : savingAudio
                            ? t("hermes.voice.saving")
                            : transcribing
                              ? t("hermes.voice.transcribing")
                              : t("hermes.voice.transcribeAudio")
                      }
                      title={
                        isWavFallbackRecording
                          ? t("hermes.voice.stopAndSave")
                          : transcribing
                            ? t("hermes.voice.transcribing")
                            : sttServiceReady
                              ? `${t("hermes.voice.transcribeAudio")} · Whisper local`
                              : t("hermes.voice.transcribeAudio")
                      }
                      onClick={() => void handleTranscribeOrVoiceClick()}
                      className={
                        micActive
                          ? "rounded-lg h-7 px-2.5 shrink-0"
                          : "relative rounded-lg h-7 w-7 p-0 text-slate-400 hover:text-sky-200 hover:bg-slate-800/70 shrink-0"
                      }
                    >
                      {isWavFallbackRecording ? (
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
                          {sttServiceReady && (
                            <span
                              aria-hidden="true"
                              className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-400"
                            />
                          )}
                        </>
                      )}
                    </Button>
                  );
                })()}

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-testid="aura-autospeak-toggle"
                  aria-pressed={voiceSettings.autoSpeak}
                  aria-label={
                    voiceSettings.autoSpeak
                      ? t("hermes.voice.autoSpeakOn")
                      : t("hermes.voice.autoSpeakOff")
                  }
                  title={
                    voiceSettings.autoSpeak
                      ? t("hermes.voice.autoSpeakOn")
                      : t("hermes.voice.autoSpeakOff")
                  }
                  onClick={toggleAutoSpeak}
                  className={
                    voiceSettings.autoSpeak
                      ? "rounded-lg h-7 px-2 bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40 shrink-0"
                      : "rounded-lg h-7 w-7 p-0 text-slate-400 hover:text-sky-200 hover:bg-slate-800/70 shrink-0"
                  }
                >
                  {voiceSettings.autoSpeak ? (
                    <>
                      <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="text-[11px]">{t("hermes.voice.speakOnlyShort")}</span>
                    </>
                  ) : (
                    <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </Button>

                {liveSpeaking && (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    data-testid="aura-stop-speaking-btn"
                    onClick={stopSpeechSynthesis}
                    aria-label={t("hermes.stopSpeaking")}
                    title={t("hermes.stopSpeaking")}
                    className="rounded-lg h-7 px-2 shrink-0"
                  >
                    <Square className="h-3 w-3" aria-hidden="true" />
                    <span className="text-[11px]">{t("hermes.stopSpeaking")}</span>
                  </Button>
                )}
              </div>

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
                  className="rounded-xl h-8 px-3.5 shrink-0"
                >
                  <Send className="h-3 w-3" aria-hidden="true" />
                  <span className="text-[11px]">{t("hermes.sendButton")}</span>
                </Button>
              )}
            </div>
          </form>

          {/* The shortcuts are written down, so nobody has to guess them (hidden in prompt-only mode). */}
          {showTranscript && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-0.5 text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-slate-700/80 bg-slate-900/70 px-1 font-sans text-[9px] text-slate-400">
                  Enter
                </kbd>
                {t("hermes.shortcutSend")}
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-slate-700/80 bg-slate-900/70 px-1 font-sans text-[9px] text-slate-400">
                  ↑
                </kbd>
                <kbd className="rounded border border-slate-700/80 bg-slate-900/70 px-1 font-sans text-[9px] text-slate-400">
                  ↓
                </kbd>
                {t("hermes.shortcutHistory")}
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-slate-700/80 bg-slate-900/70 px-1 font-sans text-[9px] text-slate-400">
                  Ctrl
                </kbd>
                <kbd className="rounded border border-slate-700/80 bg-slate-900/70 px-1 font-sans text-[9px] text-slate-400">
                  K
                </kbd>
                {t("hermes.shortcutCommands")}
              </span>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

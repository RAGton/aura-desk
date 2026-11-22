import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  AudioLines,
  ChevronDown,
  Layers,
  MessageSquare,
  Mic,
  Plus,
  Radio,
  Send,
  Sparkles,
  Square,
  Terminal,
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

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const recordingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveModeRef = useRef(false);
  const sendingRef = useRef(false);
  const streamBuffersRef = useRef<Map<string, string>>(new Map());
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
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore speech synthesis cancellation errors
      }
    }
    if (mountedRef.current) setLiveSpeaking(false);
  }, []);

  const speakReply = useCallback(
    (text: string) => {
      if (!liveModeRef.current || !text.trim()) return;
      if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window) ||
        typeof SpeechSynthesisUtterance === "undefined"
      ) {
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = speechLang;
        utterance.onstart = () => {
          if (mountedRef.current) setLiveSpeaking(true);
        };
        utterance.onend = () => {
          if (mountedRef.current) setLiveSpeaking(false);
        };
        utterance.onerror = () => {
          if (mountedRef.current) setLiveSpeaking(false);
        };
        window.speechSynthesis.speak(utterance);
      } catch {
        if (mountedRef.current) setLiveSpeaking(false);
      }
    },
    [speechLang]
  );

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
            if (done) {
              streamBuffersRef.current.delete(requestId);
              if (liveModeRef.current && nextAcc.trim()) {
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
    if (showTranscript && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages, showTranscript]);

  const sendPrompt = useCallback(
    async (textOverride?: string) => {
      const raw = (textOverride ?? prompt).trim();
      if (!raw || sendingRef.current) return;

      sendingRef.current = true;
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendPrompt();
  };

  const stopAndSaveWavCapture = useCallback(async () => {
    const sampleRate = audioCtxRef.current?.sampleRate ?? 16_000;
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    recordingRef.current = false;
    setRecording(false);
    stopAudioTracks();

    setSavingAudio(true);
    setErrorMsg(null);
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
          pcmChunksRef.current.push(new Float32Array(channel));
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

      recognition.onerror = (ev) => {
        if (!mountedRef.current) return;
        setTranscribing(false);
        recognitionRef.current = null;
        if (ev.error !== "aborted" && ev.error !== "no-speech") {
          setErrorMsg(t("hermes.voice.failed"));
        }
      };

      recognition.onend = () => {
        if (!mountedRef.current) return;
        setTranscribing(false);
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
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

  return (
    <div className="relative flex-1 h-full w-full min-h-[540px] flex flex-col justify-between overflow-hidden">
      {/* Fullscreen Cosmic 3D/4D Pyramid Canvas */}
      <div className="absolute inset-0 z-0 flex flex-col">
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
      </div>

      {/* Bottom Floating Prompt Dock */}
      <div className="aura-galaxy-chrome-scope pointer-events-none absolute bottom-4 inset-x-0 z-20 flex flex-col items-center px-4">
        <div className="pointer-events-auto w-full max-w-3xl space-y-2">
          {/* Status / Session / Context / Transcript Row integrated cleanly along dock edge */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="aura-new-session-btn"
              disabled={creatingSession}
              onClick={() => void handleNewSession()}
              className="h-6 rounded-full border border-sky-400/35 bg-slate-950/75 backdrop-blur-md px-2.5 text-[11px] text-sky-200 hover:bg-sky-500/20"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {t("hermes.newSession")}
            </Button>

            {contextInspection && (
              <button
                type="button"
                data-testid="aura-context-pill"
                onClick={() => onOpenSessions?.()}
                className="inline-flex items-center gap-1 rounded-full border border-sky-400/25 bg-slate-950/70 backdrop-blur-md px-2.5 py-0.5 text-[11px] text-sky-200 hover:border-sky-400/60 cursor-pointer"
              >
                <Layers className="h-3 w-3 text-sky-400" aria-hidden="true" />
                <span>{t("hermes.contextPill", { pct: contextInspection.usagePct })}</span>
              </button>
            )}

            {aiStatus && (
              <Badge
                variant={aiStatus.ready ? "info" : "warning"}
                className="rounded-full bg-slate-950/65 backdrop-blur-md"
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
              className="rounded-full bg-slate-950/65 backdrop-blur-md"
            >
              <Terminal className="h-3 w-3" aria-hidden="true" />
              {status.available
                ? t("hermes.cliOnline", { path: status.binaryPath ?? "hermes" })
                : t("hermes.cliOffline")}
            </Badge>

            {status.available && (
              <label className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-slate-950/65 px-3 py-0.5 text-[11px] text-slate-200 backdrop-blur-md cursor-pointer">
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
                className="h-6 rounded-full border border-sky-400/25 bg-slate-950/70 backdrop-blur-md px-2.5 text-[11px] text-sky-200 hover:bg-sky-500/20"
              >
                <MessageSquare className="h-3 w-3" aria-hidden="true" />
                {t("hermes.voice.toggleTranscript", { count: messages.length })}
              </Button>
            )}
          </div>

          {/* Subtle floating feedback / voice / error banners */}
          {feedback && (
            <div
              role="status"
              className="rounded-full border border-emerald-400/35 bg-slate-950/75 backdrop-blur-xl px-4 py-1.5 text-xs text-emerald-300 text-center shadow-lg"
            >
              {feedback}
            </div>
          )}

          {voiceBanner && (
            <div
              role="status"
              className="rounded-full border border-sky-400/35 bg-slate-950/75 backdrop-blur-xl px-4 py-1.5 text-xs text-sky-200 text-center break-all shadow-lg"
            >
              {voiceBanner}
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="rounded-full border border-rose-400/40 bg-slate-950/80 backdrop-blur-xl px-4 py-1.5 text-xs text-rose-300 text-center shadow-lg"
            >
              {errorMsg}
            </div>
          )}

          {/* Floating Translucent Message Popover */}
          {messages.length > 0 && showTranscript && (
            <div className="rounded-2xl border border-sky-400/20 bg-slate-950/70 backdrop-blur-xl px-4 py-3 shadow-2xl shadow-sky-950/40 space-y-2.5">
              <div className="flex items-center justify-between gap-2 border-b border-sky-400/15 pb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Sparkles className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                  {t("hermes.chatTitle")}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMessages([]);
                      void aiApi?.chatClear?.(activeSessionId).catch(() => {});
                    }}
                    className="h-7 px-2.5 text-[11px] text-slate-300 hover:text-white rounded-full"
                  >
                    {t("hermes.clearChat")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowTranscript(false)}
                    className="h-7 px-2.5 text-[11px] text-slate-300 hover:text-white rounded-full"
                  >
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("hermes.voice.hideTranscript")}
                  </Button>
                </div>
              </div>

              <div
                ref={transcriptRef}
                className="max-h-52 overflow-y-auto space-y-2.5 pr-1"
              >
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={
                      msg.role === "user"
                        ? "ml-auto max-w-[85%] rounded-xl bg-sky-500/20 border border-sky-400/35 px-3 py-2 text-xs text-slate-100"
                        : "mr-auto max-w-[90%] rounded-xl bg-slate-900/80 border border-slate-700/60 px-3 py-2 text-xs text-slate-100"
                    }
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                      {msg.role === "user" ? t("hermes.userRole") : t("hermes.assistantRole")}
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Prompt Chips */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPrompt(`${t("hermes.quickActions.createTask")}: `)}
              className="aura-galaxy-chip h-7 rounded-full backdrop-blur-md px-3 text-xs"
            >
              {t("hermes.quickActions.createTask")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPrompt(`${t("hermes.quickActions.createReminder")}: `)}
              className="aura-galaxy-chip h-7 rounded-full backdrop-blur-md px-3 text-xs"
            >
              {t("hermes.quickActions.createReminder")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void sendPrompt("summary")}
              className="aura-galaxy-chip h-7 rounded-full backdrop-blur-md px-3 text-xs"
            >
              {t("hermes.quickActions.summary")}
            </Button>
          </div>

          {/* Floating Prompt Capsule */}
          <form
            onSubmit={handleSubmit}
            className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-full border border-sky-400/30 bg-slate-950/75 backdrop-blur-xl px-3 py-2 shadow-2xl shadow-sky-950/50"
          >
            <Button
              type="button"
              size="sm"
              variant={liveMode ? "danger" : "secondary"}
              aria-pressed={liveMode}
              onClick={() => void toggleLiveMode()}
              className="rounded-full h-9 px-3 shrink-0"
            >
              {liveMode ? (
                <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
              ) : (
                <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {liveMode ? t("hermes.voice.liveModeOn") : t("hermes.voice.liveModeOff")}
              </span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant={recording || transcribing ? "danger" : "secondary"}
              loading={savingAudio}
              aria-pressed={recording || transcribing}
              onClick={() => void handleTranscribeOrVoiceClick()}
              className="rounded-full h-9 px-3 shrink-0"
            >
              {recording ? (
                <>
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t("hermes.voice.stopAndSave")}</span>
                </>
              ) : savingAudio ? (
                <span>{t("hermes.voice.saving")}</span>
              ) : transcribing ? (
                <>
                  <Mic className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                  <span>{t("hermes.voice.transcribing")}</span>
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t("hermes.voice.transcribeAudio")}</span>
                </>
              )}
            </Button>

            <Input
              containerClassName="flex-1 min-w-[160px]"
              className="border-0 bg-transparent px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 focus-visible:ring-0"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("hermes.chatPlaceholder")}
              aria-label={t("hermes.chatTitle")}
            />

            <Button
              type="submit"
              size="sm"
              loading={sending}
              disabled={!prompt.trim() || sending}
              className="rounded-full h-9 px-4 shrink-0"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{sending ? t("hermes.sending") : t("hermes.sendButton")}</span>
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

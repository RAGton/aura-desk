import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Cpu, Volume2, X } from "lucide-react";
import { Badge, Button } from "../../components/ui";
import {
  isTauriRuntime,
  voiceApi,
  type VoiceServiceProgress,
  type VoiceServiceStatus,
} from "../../lib/ipc";
import { AuraAudioPlayer } from "./auraAudioPlayer";
import {
  getAvailableAuraVoices,
  saveVoiceSettings,
  speakAuraUtterance,
  type AuraVoiceSettings,
  type DetectedVoice,
} from "./auraVoiceEngine";
import {
  listAuraServiceVoices,
  probeAuraVoiceService,
  synthesizeAuraPcm,
  type AuraServiceVoice,
} from "./auraVoiceService";
import { probeAuraSttService } from "./auraSpeechToText";

export interface AuraVoiceSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: AuraVoiceSettings;
  onSettingsChange: (settings: AuraVoiceSettings) => void;
}

/** Languages shown first in the picker, in this order. */
const LANGUAGE_ORDER = ["pt-BR", "en-US", "en-GB", "espeak"];

export function AuraVoiceSettingsModal({
  open,
  onClose,
  settings,
  onSettingsChange,
}: AuraVoiceSettingsModalProps) {
  const { t } = useTranslation();
  const [serviceVoices, setServiceVoices] = useState<AuraServiceVoice[]>([]);
  const [browserVoices, setBrowserVoices] = useState<DetectedVoice[]>([]);
  const [status, setStatus] = useState<VoiceServiceStatus | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [testingVoice, setTestingVoice] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  const playerRef = useRef<AuraAudioPlayer | null>(null);
  if (!playerRef.current) {
    playerRef.current = new AuraAudioPlayer();
  }

  const refresh = useCallback(async () => {
    // The desktop app knows the full container state; the browser build only
    // gets what the HTTP probe can tell us.
    if (isTauriRuntime()) {
      try {
        const reported = await voiceApi.status();
        setStatus(reported);
        if (reported.serviceReady) {
          setServiceVoices(await listAuraServiceVoices(reported.baseUrl));
        } else {
          setServiceVoices([]);
        }
        setBrowserVoices(getAvailableAuraVoices());
        return;
      } catch {
        // fall through to the plain HTTP probe
      }
    }

    const [probe, sttReady] = await Promise.all([
      probeAuraVoiceService(),
      probeAuraSttService(),
    ]);
    setStatus({
      runtimeAvailable: probe.available || sttReady,
      runtime: probe.available || sttReady ? "podman" : null,
      serviceReady: probe.available,
      containerRunning: probe.available,
      imagePresent: probe.available,
      baseUrl: "http://127.0.0.1:8925",
      image: "ghcr.io/remsky/kokoro-fastapi-cpu:latest",
      voiceCount: probe.voiceCount,
      detail: probe.available ? null : t("hermes.voiceServiceOffline"),
      sttReady,
      sttBaseUrl: "http://127.0.0.1:9000",
      sttContainerRunning: sttReady,
    });
    if (probe.available) {
      setServiceVoices(await listAuraServiceVoices());
    } else {
      setServiceVoices([]);
    }
    setBrowserVoices(getAvailableAuraVoices());
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void refresh();

    const onProgress = (event: { payload: VoiceServiceProgress }) => {
      const payload = event.payload;
      setProgressMessage(payload.message);
      setStatus(payload.status);
      if (payload.stage === "ready") {
        setProvisioning(false);
        void refresh();
      }
      if (payload.stage === "error") {
        setProvisioning(false);
      }
    };

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    if (isTauriRuntime()) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen<VoiceServiceProgress>("auradesk://voice-progress", onProgress)
        )
        .then((fn) => {
          if (cancelled) {
            fn();
          } else {
            unlisten = fn;
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [open, refresh]);

  // Keep the picker honest when the selected voice disappears (e.g. the
  // service was reinstalled with a different catalogue).
  useEffect(() => {
    if (settings.engine !== "neural") return;
    if (serviceVoices.length === 0) return;
    if (serviceVoices.some((v) => v.id === settings.serviceVoice)) return;
    const updated = { ...settings, serviceVoice: serviceVoices[0].id };
    onSettingsChange(updated);
    saveVoiceSettings(updated);
  }, [serviceVoices, settings, onSettingsChange]);

  const groupedVoices = useMemo(() => {
    const groups = new Map<string, AuraServiceVoice[]>();
    for (const voice of serviceVoices) {
      const key = voice.language;
      const list = groups.get(key) ?? [];
      list.push(voice);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(
      ([a], [b]) =>
        LANGUAGE_ORDER.indexOf(a) - LANGUAGE_ORDER.indexOf(b)
    );
  }, [serviceVoices]);

  const persist = (updated: AuraVoiceSettings) => {
    onSettingsChange(updated);
    saveVoiceSettings(updated);
  };

  const handleVoiceSelect = (voiceId: string) => {
    persist({ ...settings, serviceVoice: voiceId });
  };

  const handleSpeedChange = (speed: number) => {
    persist({ ...settings, speed });
  };

  const handleEngineChange = (engine: "neural" | "browser") => {
    persist({ ...settings, engine });
  };

  const handleAutoSpeakToggle = (autoSpeak: boolean) => {
    persist({ ...settings, autoSpeak });
  };

  const handleTestVoice = async (voiceId?: string) => {
    const phrase = t("hermes.voiceTestPhrase");
    setEngineError(null);

    if (settings.engine === "neural") {
      const target = voiceId ?? settings.serviceVoice;
      setTestingVoice(target);
      try {
        const player = playerRef.current;
        player?.resetStreamAlignment();
        await player?.resume();
        await synthesizeAuraPcm(
          phrase,
          { voice: target, speed: settings.speed },
          (chunk) => player?.play(chunk)
        );
      } catch (error) {
        setEngineError(error instanceof Error ? error.message : String(error));
      } finally {
        playerRef.current?.resetStreamAlignment();
        setTestingVoice(null);
      }
      return;
    }

    setTestingVoice(voiceId ?? settings.selectedVoiceURI);
    speakAuraUtterance(
      phrase,
      settings,
      () => setTestingVoice(voiceId ?? settings.selectedVoiceURI),
      () => setTestingVoice(null),
      () => setTestingVoice(null)
    );
  };

  const handleProvision = async () => {
    setProvisioning(true);
    setProgressMessage(t("hermes.voiceServiceStarting"));
    setEngineError(null);
    try {
      const outcome = await voiceApi.start();
      if (!outcome.ok) {
        setEngineError(outcome.message);
        setProvisioning(false);
      }
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : String(error));
      setProvisioning(false);
    }
  };

  if (!open) return null;

  const serviceReady = status?.serviceReady ?? false;

  return (
    <div className="aura-galaxy-chrome-scope fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4">
      <div className="w-full max-w-md rounded-2xl border border-sky-400/30 bg-slate-950/90 backdrop-blur-2xl p-5 shadow-2xl shadow-sky-950/50 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sky-400/20 pb-3">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-sky-400" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-slate-100">
              {t("hermes.voiceConfigTitle")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label={t("common.close", { defaultValue: "Fechar" })}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Service status */}
        <div className="flex items-start gap-2 rounded-xl border border-sky-400/20 bg-slate-900/60 px-3 py-2">
          <Cpu
            className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${serviceReady ? "text-emerald-400" : "text-amber-400"}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[11px] text-slate-300">
              {serviceReady
                ? t("hermes.voiceServiceReady", { count: status?.voiceCount ?? 0 })
                : t("hermes.voiceServiceOffline")}
            </p>
            {progressMessage && (
              <p className="text-[10px] text-sky-300" role="status">
                {progressMessage}
              </p>
            )}
            {engineError && (
              <p className="text-[10px] text-rose-300" role="alert">
                {engineError}
              </p>
            )}
            {!serviceReady && !provisioning && (
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={handleProvision}
                className="rounded-full text-[10px] h-6 px-3"
              >
                {t("hermes.voiceServiceInstall")}
              </Button>
            )}
          </div>
        </div>

        {/* Engine selector */}
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={settings.engine === "neural" ? "primary" : "ghost"}
            onClick={() => handleEngineChange("neural")}
            disabled={!serviceReady}
            className="rounded-full text-[10px] h-6 px-3"
          >
            {t("hermes.voiceEngineNeural")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={settings.engine === "browser" ? "primary" : "ghost"}
            onClick={() => handleEngineChange("browser")}
            className="rounded-full text-[10px] h-6 px-3"
          >
            {t("hermes.voiceEngineBrowser")}
          </Button>
        </div>

        {/* Voice Selection */}
        {settings.engine === "neural" ? (
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-300">
              {t("hermes.voiceSelectLabel")}
            </label>
            <div className="max-h-56 overflow-y-auto space-y-2 rounded-xl border border-sky-400/20 bg-slate-900/60 p-1.5">
              {groupedVoices.length === 0 ? (
                <div className="p-2 text-xs text-slate-400 text-center">
                  {t("hermes.voiceServiceOffline")}
                </div>
              ) : (
                groupedVoices.map(([language, voices]) => (
                  <div key={language} className="space-y-1">
                    <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {language}
                    </p>
                    {voices.map((v) => {
                      const isSelected = settings.serviceVoice === v.id;
                      const isTesting = testingVoice === v.id;
                      return (
                        <div
                          key={v.id}
                          className={`flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
                            isSelected
                              ? "bg-sky-500/25 border border-sky-400/40 text-sky-100"
                              : "hover:bg-slate-800/60 text-slate-300"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleVoiceSelect(v.id)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
                          >
                            <span className="truncate">{v.label}</span>
                            <Badge
                              variant={v.gender === "female" ? "info" : "default"}
                              className="shrink-0 px-1 text-[9px] h-4"
                            >
                              {v.gender === "female" ? "F" : "M"}
                            </Badge>
                            {v.grade && (
                              <span className="shrink-0 text-[9px] text-slate-500">
                                {v.grade}
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTestVoice(v.id)}
                            aria-label={t("hermes.voiceTestButton")}
                            title={t("hermes.voiceTestButton")}
                            className="shrink-0 rounded-full p-1 text-slate-400 hover:text-sky-300 hover:bg-slate-800"
                          >
                            <Volume2
                              className={`h-3 w-3 ${isTesting ? "animate-pulse text-sky-400" : ""}`}
                              aria-hidden="true"
                            />
                          </button>
                          {isSelected && (
                            <Check className="h-3 w-3 shrink-0 text-sky-400" aria-hidden="true" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-300">
              {t("hermes.voiceSelectLabel")}
            </label>
            <div className="max-h-36 overflow-y-auto space-y-1 rounded-xl border border-sky-400/20 bg-slate-900/60 p-1.5">
              {browserVoices.length === 0 ? (
                <div className="p-2 text-xs text-slate-400 text-center">
                  {t("hermes.voice.unsupported")}
                </div>
              ) : (
                browserVoices.map((v) => {
                  const isSelected = settings.selectedVoiceURI === v.voiceURI;
                  return (
                    <button
                      key={v.voiceURI}
                      type="button"
                      onClick={() =>
                        persist({ ...settings, selectedVoiceURI: v.voiceURI })
                      }
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors ${
                        isSelected
                          ? "bg-sky-500/25 border border-sky-400/40 text-sky-100"
                          : "hover:bg-slate-800/60 text-slate-300"
                      }`}
                    >
                      <div className="truncate flex items-center gap-1.5">
                        <span className="truncate">{v.name}</span>
                        {v.isPtBr && (
                          <Badge variant="info" className="text-[9px] px-1 py-0 h-4">
                            pt-BR
                          </Badge>
                        )}
                      </div>
                      {isSelected && (
                        <Check className="h-3 w-3 text-sky-400 shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Speech Speed Slider */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-300">
            <span>{t("hermes.voiceSpeedLabel", { speed: settings.speed.toFixed(1) })}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">0.6x</span>
            <input
              type="range"
              min="0.6"
              max="1.6"
              step="0.05"
              value={settings.speed}
              onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
              className="flex-1 accent-sky-400 cursor-pointer"
            />
            <span className="text-[10px] text-slate-400">1.6x</span>
          </div>
        </div>

        {/* Layout & Auto-Speak Toggles */}
        <div className="space-y-2 border-t border-sky-400/15 pt-3">
          <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
            <span>{t("hermes.autoSpeakLabel")}</span>
            <input
              type="checkbox"
              checked={settings.autoSpeak}
              onChange={(e) => handleAutoSpeakToggle(e.target.checked)}
              className="accent-sky-400 rounded h-4 w-4 cursor-pointer"
            />
          </label>

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-sky-400/20 pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={testingVoice !== null}
            onClick={() => handleTestVoice()}
            className="rounded-full text-xs h-8 px-3"
          >
            <Volume2
              className={`h-3.5 w-3.5 ${testingVoice ? "animate-bounce text-sky-400" : ""}`}
              aria-hidden="true"
            />
            <span>{t("hermes.voiceTestButton")}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={onClose}
            className="rounded-full text-xs h-8 px-4"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("common.save", { defaultValue: "Salvar" })}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

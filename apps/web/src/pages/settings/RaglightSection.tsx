import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Database,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  HelpCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Wrench,
  X,
} from "lucide-react";

import { Badge, Button, Input, Select, Switch } from "@/components/ui";
import {
  desktopApi,
  isTauriRuntime,
  raglightApi,
  type RaglightQueryResult,
  type RaglightStatus,
} from "@/lib/ipc";

export interface RaglightSectionProps {
  values: Record<string, unknown>;
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
  onSave: (key: string, value: unknown) => void;
}

/**
 * One step of bringing the knowledge service up.
 *
 * The number says where it is in the sequence, the tick says it is behind
 * us, and the line below says what the step does — so the order is never
 * something the reader has to guess.
 */
function Step({
  n,
  done,
  title,
  hint,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border p-3 ${
        done
          ? "border-emerald-400/35 bg-emerald-500/10"
          : "border-aura-border/40 bg-aura-canvas/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            done
              ? "bg-emerald-400/20 text-emerald-300"
              : "bg-aura-accent/20 text-aura-accent"
          }`}
        >
          {done ? <Check className="h-3 w-3" aria-hidden="true" /> : n}
        </span>
        <span className="text-xs font-semibold text-aura-primary">{title}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-aura-text-muted">{hint}</p>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function parseFolderList(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function RaglightSection({
  values,
  disabled,
  onChange,
  onSave,
}: RaglightSectionProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RaglightStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [outputTail, setOutputTail] = useState<string>("");
  const [newFolderInput, setNewFolderInput] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [testQuery, setTestQuery] = useState("");
  const [queryResult, setQueryResult] = useState<RaglightQueryResult | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await raglightApi?.status?.();
      if (s) setStatus(s);
    } catch {
      // ignore status probe failure in mocked/browser tests
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const enabled = Boolean(values["raglight.enabled"]);
  const mode = String(values["raglight.mode"] ?? "managed_local");
  const provider = String(values["raglight.provider"] ?? "ollama");
  const vectorStore = String(values["raglight.vector_store"] ?? "chroma");
  const baseUrl = String(values["raglight.base_url"] ?? "http://127.0.0.1:8000");
  const llmModel = String(values["raglight.llm_model"] ?? "qwen3:0.6b");
  const embeddingModel = String(values["raglight.embedding_model"] ?? "nomic-embed-text");
  const apiKey = String(values["raglight.api_key"] ?? "");
  const foldersRaw = String(values["raglight.folders"] ?? "");
  const folderList = parseFolderList(foldersRaw);

  const commitFolders = (nextList: string[]) => {
    const deduped = Array.from(new Set(nextList.map((f) => f.trim()).filter(Boolean)));
    const serialized = deduped.join(";");
    onChange("raglight.folders", serialized);
    onSave("raglight.folders", serialized);
  };

  const handlePickFolder = async () => {
    setBusy("pick");
    try {
      const chosen = await desktopApi?.pickFolder?.();
      if (chosen && chosen.trim()) {
        commitFolders([...folderList, chosen.trim()]);
      } else if (!isTauriRuntime()) {
        setFeedback(t("settings.raglight.pickFolderDesktopOnly"));
      }
    } catch (err) {
      setFeedback(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleAddManualFolder = () => {
    const trimmed = newFolderInput.trim();
    if (!trimmed) return;
    commitFolders([...folderList, trimmed]);
    setNewFolderInput("");
  };

  const handleManualKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddManualFolder();
    }
  };

  const runAction = async (
    actionName: string,
    fn: () => Promise<{ ok: boolean; message: string; outputTail: string; status: RaglightStatus }>
  ) => {
    setBusy(actionName);
    setFeedback(null);
    try {
      const res = await fn();
      setStatus(res.status);
      setOutputTail(res.outputTail || "");
      setFeedback(res.ok ? t("settings.raglight.actionOk", { msg: res.message }) : res.message);
    } catch (err) {
      setFeedback(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleTestQuery = async () => {
    if (!testQuery.trim()) return;
    setBusy("query");
    setFeedback(null);
    try {
      const res = await raglightApi.query(testQuery.trim(), 5);
      setQueryResult(res);
    } catch (err) {
      setFeedback(String(err));
    } finally {
      setBusy(null);
    }
  };

  const isWorking = disabled || busy !== null;

  return (
    <section
      aria-label={t("settings.raglight.title")}
      className="lg:col-span-2 rounded-2xl aura-glass p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
          <span className="rounded-lg bg-emerald-500/15 p-1.5">
            <Database className="h-3.5 w-3.5 text-emerald-400" />
          </span>
          {t("settings.raglight.title")}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status?.installed ? "success" : "neutral"} className="text-[11px]">
            {status?.installed
              ? t("settings.raglight.statusInstalled")
              : t("settings.raglight.statusNotInstalled")}
          </Badge>
          <Badge variant={status?.running ? "success" : "warning"} className="text-[11px]">
            {status?.running
              ? t("settings.raglight.statusRunning")
              : t("settings.raglight.statusStopped")}
          </Badge>
          {status?.pythonTool && (
            <Badge variant="info" className="font-mono text-[11px]">
              {status.pythonTool}
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="rounded-lg text-[11px]"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {t("settings.raglight.guideTitle")}
          </Button>
        </div>
      </div>

      <p className="text-xs text-aura-text-muted">{t("settings.raglight.description")}</p>

      {showGuide && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 space-y-1.5 text-xs text-aura-primary">
          <p className="font-semibold text-emerald-400">{t("settings.raglight.guideTitle")}</p>
          <p>{t("settings.raglight.guideStep1")}</p>
          <p>{t("settings.raglight.guideStep2")}</p>
          <p>{t("settings.raglight.guideStep3")}</p>
        </div>
      )}

      {/* Enable switch */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-aura-border/40 bg-aura-surface/70 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-aura-primary">
            {t("settings.raglight.enableLabel")}
          </div>
          <div className="text-xs text-aura-text-muted">
            {t("settings.raglight.enableDescription")}
          </div>
        </div>
        <Switch
          disabled={isWorking}
          aria-label={t("settings.raglight.enableLabel")}
          checked={enabled}
          onCheckedChange={(next) => {
            onChange("raglight.enabled", next);
            onSave("raglight.enabled", next);
          }}
        />
      </div>

      {/* Mode + Provider + Vector Store */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-aura-secondary">
            {t("settings.raglight.modeLabel")}
          </label>
          <Select
            disabled={isWorking}
            aria-label={t("settings.raglight.modeLabel")}
            value={mode}
            onChange={(e) => {
              onChange("raglight.mode", e.target.value);
              onSave("raglight.mode", e.target.value);
            }}
          >
            <option value="managed_local">{t("settings.raglight.modeManagedLocal")}</option>
            <option value="external_url">{t("settings.raglight.modeExternalUrl")}</option>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-aura-secondary">
            {t("settings.raglight.providerLabel")}
          </label>
          <Select
            disabled={isWorking}
            aria-label={t("settings.raglight.providerLabel")}
            value={provider}
            onChange={(e) => {
              onChange("raglight.provider", e.target.value);
              onSave("raglight.provider", e.target.value);
            }}
          >
            <option value="ollama">{t("settings.raglight.providers.ollama")}</option>
            <option value="lmstudio">{t("settings.raglight.providers.lmstudio")}</option>
            <option value="vllm">{t("settings.raglight.providers.vllm")}</option>
            <option value="openai">{t("settings.raglight.providers.openai")}</option>
            <option value="gemini">{t("settings.raglight.providers.gemini")}</option>
            <option value="mistral">{t("settings.raglight.providers.mistral")}</option>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-aura-secondary">
            {t("settings.raglight.vectorStoreLabel")}
          </label>
          <Select
            disabled={isWorking}
            aria-label={t("settings.raglight.vectorStoreLabel")}
            value={vectorStore}
            onChange={(e) => {
              onChange("raglight.vector_store", e.target.value);
              onSave("raglight.vector_store", e.target.value);
            }}
          >
            <option value="chroma">ChromaDB</option>
            <option value="qdrant">Qdrant</option>
          </Select>
        </div>
      </div>

      {/* URL, Models, API Key */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-aura-secondary">
              {t("settings.raglight.baseUrlLabel")}
            </label>
            <Input
              aria-label={t("settings.raglight.baseUrlLabel")}
              value={baseUrl}
              placeholder="http://127.0.0.1:8000"
              onChange={(e) => onChange("raglight.base_url", e.target.value)}
            />
          </div>
          <Button
            size="md"
            variant="secondary"
            disabled={isWorking}
            onClick={() => onSave("raglight.base_url", baseUrl)}
          >
            {t("kanban.save")}
          </Button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-aura-secondary">
              {t("settings.raglight.apiKeyLabel")}
            </label>
            <Input
              aria-label={t("settings.raglight.apiKeyLabel")}
              type="password"
              value={apiKey}
              placeholder="sk-..."
              onChange={(e) => onChange("raglight.api_key", e.target.value)}
            />
          </div>
          <Button
            size="md"
            variant="secondary"
            disabled={isWorking}
            onClick={() => onSave("raglight.api_key", apiKey)}
          >
            {t("kanban.save")}
          </Button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-aura-secondary">
              {t("settings.raglight.llmModelLabel")}
            </label>
            <Input
              aria-label={t("settings.raglight.llmModelLabel")}
              value={llmModel}
              placeholder="qwen3:0.6b"
              onChange={(e) => onChange("raglight.llm_model", e.target.value)}
            />
          </div>
          <Button
            size="md"
            variant="secondary"
            disabled={isWorking}
            onClick={() => onSave("raglight.llm_model", llmModel)}
          >
            {t("kanban.save")}
          </Button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-aura-secondary">
              {t("settings.raglight.embeddingModelLabel")}
            </label>
            <Input
              aria-label={t("settings.raglight.embeddingModelLabel")}
              value={embeddingModel}
              placeholder="nomic-embed-text"
              onChange={(e) => onChange("raglight.embedding_model", e.target.value)}
            />
          </div>
          <Button
            size="md"
            variant="secondary"
            disabled={isWorking}
            onClick={() => onSave("raglight.embedding_model", embeddingModel)}
          >
            {t("kanban.save")}
          </Button>
        </div>
      </div>

      {/* Visual Folder Picker & Chips */}
      <div className="rounded-xl border border-aura-border/40 bg-aura-surface/70 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-aura-primary">
            <FolderOpen className="h-3.5 w-3.5 text-emerald-400" />
            {t("settings.raglight.foldersLabel")}
          </span>
          <Button
            size="sm"
            variant="primary"
            type="button"
            disabled={isWorking}
            onClick={() => void handlePickFolder()}
            className="rounded-xl text-xs font-semibold"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {t("settings.raglight.pickFolderButton")}
          </Button>
        </div>

        {folderList.length === 0 ? (
          <p className="text-xs text-aura-text-muted">{t("settings.raglight.noFoldersSelected")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {folderList.map((folder) => (
              <span
                key={folder}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-300"
              >
                <span className="truncate max-w-[260px]">{folder}</span>
                <button
                  type="button"
                  disabled={isWorking}
                  aria-label={`${t("settings.raglight.removeFolder")}: ${folder}`}
                  onClick={() => commitFolders(folderList.filter((f) => f !== folder))}
                  className="rounded p-0.5 text-aura-secondary hover:bg-rose-500/20 hover:text-rose-300"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            containerClassName="flex-1"
            aria-label={t("settings.raglight.foldersLabel")}
            value={newFolderInput}
            placeholder={t("settings.raglight.foldersPlaceholder")}
            onChange={(e) => setNewFolderInput(e.target.value)}
            onKeyDown={handleManualKeyDown}
          />
          <Button
            size="md"
            variant="secondary"
            type="button"
            disabled={isWorking || !newFolderInput.trim()}
            onClick={handleAddManualFolder}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("settings.raglight.addPathButton")}
          </Button>
        </div>
      </div>

      {/* Provisioning & Server Actions
          The three steps, in order. A flat row of four buttons left the
          reader guessing which one comes first and which ones are even
          possible yet. */}
      <div className="space-y-2 pt-1" data-testid="raglight-steps">
        {mode === "managed_local" && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Step
              n={1}
              done={Boolean(status?.installed)}
              title={t("settings.raglight.stepInstall")}
              hint={t("settings.raglight.stepInstallHint")}
            >
              {status?.installed ? (
                <span
                  data-testid="raglight-step-installed"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("settings.raglight.statusInstalled")}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isWorking}
                  loading={busy === "provision"}
                  onClick={() =>
                    void runAction("provision", () => raglightApi.provision())
                  }
                  className="rounded-xl text-xs font-semibold"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  {busy === "provision"
                    ? t("settings.raglight.provisioning")
                    : t("settings.raglight.provisionButton")}
                </Button>
              )}
            </Step>

            <Step
              n={2}
              done={Boolean(status?.running)}
              title={t("settings.raglight.stepStart")}
              hint={t("settings.raglight.stepStartHint")}
            >
              {status?.running ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isWorking}
                  onClick={() => void runAction("stop", () => raglightApi.stop())}
                  className="rounded-xl text-xs font-semibold"
                >
                  <Square className="h-3.5 w-3.5" />
                  {t("settings.raglight.stopButton")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isWorking || !status?.installed}
                  title={
                    status?.installed
                      ? undefined
                      : t("settings.raglight.stepNeedsInstall")
                  }
                  onClick={() => void runAction("start", () => raglightApi.start())}
                  className="rounded-xl text-xs font-semibold"
                >
                  <Play className="h-3.5 w-3.5" />
                  {busy === "start"
                    ? t("settings.raglight.starting")
                    : t("settings.raglight.startButton")}
                </Button>
              )}
            </Step>

            <Step
              n={3}
              done={false}
              title={t("settings.raglight.stepIndex")}
              hint={t("settings.raglight.stepIndexHint")}
            >
              <Button
                size="sm"
                variant="secondary"
                disabled={isWorking || !status?.running}
                title={
                  status?.running
                    ? undefined
                    : t("settings.raglight.stepNeedsRunning")
                }
                onClick={() => void runAction("ingest", () => raglightApi.ingest())}
                className="rounded-xl text-xs font-semibold"
              >
                <FolderSearch className="h-3.5 w-3.5" />
                {busy === "ingest"
                  ? t("settings.raglight.ingesting")
                  : t("settings.raglight.ingestButton")}
              </Button>
            </Step>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={isWorking}
            onClick={() => void refreshStatus()}
            className="rounded-xl text-xs font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("settings.raglight.refreshButton")}
          </Button>
        </div>
      </div>

      {/* Quick search test against the RAGLight bank */}
      <div className="flex items-center gap-2 pt-2 border-t border-aura-border/35">
        <Input
          containerClassName="flex-1"
          aria-label={t("settings.raglight.testQueryPlaceholder")}
          placeholder={t("settings.raglight.testQueryPlaceholder")}
          value={testQuery}
          onChange={(e) => setTestQuery(e.target.value)}
        />
        <Button
          size="md"
          variant="secondary"
          disabled={isWorking || !testQuery.trim()}
          onClick={() => void handleTestQuery()}
        >
          <Search className="h-3.5 w-3.5" />
          {t("settings.raglight.testQueryButton")}
        </Button>
      </div>

      {feedback && (
        <p className="text-xs text-emerald-400 break-all">{feedback}</p>
      )}

      {outputTail && (
        <pre className="max-h-32 overflow-auto rounded-xl border border-aura-border/40 bg-aura-surface/75 p-3 font-mono text-[11px] text-aura-secondary">
          {outputTail}
        </pre>
      )}

      {queryResult && (
        <div className="rounded-xl border border-aura-border/40 bg-aura-surface/75 p-3 space-y-1.5 text-xs text-aura-primary">
          <p className="whitespace-pre-wrap">{queryResult.answer || t("settings.raglight.emptyResult")}</p>
          {queryResult.sources.length > 0 && (
            <p className="text-[11px] text-aura-text-muted">
              {t("settings.raglight.sourcesLabel")}: {queryResult.sources.join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

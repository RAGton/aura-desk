import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload } from "lucide-react";

import { Button, Dialog } from "@/components/ui";
import { cn } from "@/lib/utils";

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "application/zip" });
}

export interface BackupRestoreSectionProps {
  loading: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  pendingImportFile: File | null;
  onExportZip: () => void;
  onSelectImportFile: (file: File) => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  className?: string;
}

export function BackupRestoreSection({
  loading,
  fileInputRef,
  pendingImportFile,
  onExportZip,
  onSelectImportFile,
  onConfirmImport,
  onCancelImport,
  className,
}: BackupRestoreSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <section className={cn("lg:col-span-2 rounded-2xl aura-glass p-5 space-y-3", className)}>
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
          <span className="rounded-lg bg-sky-500/15 p-1.5">
            <Download className="h-3.5 w-3.5 text-sky-400" />
          </span>
          {t("settings.groups.backup")}
        </h3>
        <p className="text-xs text-slate-400">{t("settings.backup.description")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="md"
            variant="primary"
            disabled={loading}
            onClick={onExportZip}
            className="rounded-xl text-xs font-semibold shadow-sm shadow-sky-500/25"
          >
            <Download className="h-3.5 w-3.5" />
            {t("settings.backup.exportButton")}
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            data-testid="backup-zip-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSelectImportFile(f);
            }}
            className="hidden"
          />
          <Button
            size="md"
            variant="secondary"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl text-xs font-semibold"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {t("settings.backup.importButton")}
          </Button>
        </div>
      </section>

      <Dialog
        open={Boolean(pendingImportFile)}
        onClose={onCancelImport}
        title={t("settings.backup.confirmTitle")}
        description={
          pendingImportFile
            ? t("settings.backup.confirmDescription", { file: pendingImportFile.name })
            : undefined
        }
        footer={
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={loading}
              onClick={onCancelImport}
            >
              {t("kanban.cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={loading}
              onClick={onConfirmImport}
            >
              {t("settings.backup.confirmAction")}
            </Button>
          </>
        }
      >
        <p className="text-xs text-aura-secondary">{t("settings.backup.description")}</p>
      </Dialog>
    </>
  );
}

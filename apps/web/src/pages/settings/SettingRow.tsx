import { useTranslation } from "react-i18next";

import { Badge, Button, Input, Select, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { SettingDef } from "./settingsSchema";

export interface SettingRowProps {
  def: SettingDef;
  value: unknown;
  dirty: boolean;
  disabled: boolean;
  onChange: (v: unknown) => void;
  onSave: (v: unknown) => void;
  className?: string;
}

export function SettingRow({
  def,
  value,
  dirty,
  disabled,
  onChange,
  onSave,
  className,
}: SettingRowProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-100">
          <span>{t(def.labelKey)}</span>
          {dirty && (
            <Badge variant="warning" className="px-1.5 py-0 text-[11px]">
              {t("settings.unsavedIndicator")}
            </Badge>
          )}
        </div>
        <div className="text-xs text-slate-400">{t(def.descriptionKey)}</div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (def.type === "number" || def.type === "string") {
            onSave(value);
          }
        }}
        className="flex items-center gap-2 shrink-0"
      >
        {def.type === "boolean" ? (
          <Switch
            disabled={disabled}
            aria-label={t(def.labelKey)}
            checked={Boolean(value)}
            onCheckedChange={(next) => {
              onChange(next);
              onSave(next);
            }}
          />
        ) : def.type === "select" ? (
          <Select
            containerClassName="w-auto min-w-[140px]"
            aria-label={t(def.labelKey)}
            disabled={disabled}
            value={String(value ?? "")}
            onChange={(e) => {
              const next = e.target.value;
              onChange(next);
              onSave(next);
            }}
            className="py-1.5 text-sm"
          >
            {def.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.labelKey ? t(o.labelKey) : o.label}
              </option>
            ))}
          </Select>
        ) : def.type === "number" ? (
          <Input
            containerClassName="w-24"
            aria-label={t(def.labelKey)}
            type="number"
            inputMode="numeric"
            min={1}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="py-1.5 text-sm"
          />
        ) : (
          <Input
            containerClassName="w-40"
            aria-label={t(def.labelKey)}
            type="text"
            placeholder={def.placeholder ?? ""}
            value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="py-1.5 text-sm"
          />
        )}

        {(def.type === "number" || def.type === "string") && (
          <Button
            type="submit"
            size="sm"
            variant={dirty ? "primary" : "secondary"}
            disabled={disabled}
            className="text-xs font-medium"
          >
            {t("kanban.save")}
          </Button>
        )}
      </form>
    </div>
  );
}

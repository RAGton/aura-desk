import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, CheckCircle2, Download, Droplets, Flame, Timer } from "lucide-react";

import { reportsApi, type ReportSummary } from "../lib/ipc";

export interface ReportsPageProps {
  initialReport?: ReportSummary | null;
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ReportsPage({ initialReport = null }: ReportsPageProps) {
  const { t } = useTranslation();
  const [report, setReport] = useState<ReportSummary | null>(initialReport);

  useEffect(() => {
    let active = true;
    void reportsApi
      .summary()
      .then((res) => {
        if (active && res) setReport(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // `byDay` comes newest-first from backend; flip chronologically left-to-right for the chart.
  const days = [...(report?.byDay ?? [])].reverse();
  const maxMinutes = Math.max(
    30,
    ...days.map((d) => Math.max(d.focusMin, d.breakMin))
  );

  const exportCsv = () => {
    if (!report) return;
    const header = "date,focus_min,break_min,water_count,pomodoros,tasks_done";
    const rows = report.byDay.map(
      (d) => `${d.date},${d.focusMin},${d.breakMin},${d.waterCount},${d.pomodoros},${d.tasksDone}`
    );
    const today = new Date().toISOString().slice(0, 10);
    triggerDownload(`auradesk-reports-${today}.csv`, [header, ...rows].join("\n"), "text/csv;charset=utf-8");
  };

  const exportJson = () => {
    if (!report) return;
    const today = new Date().toISOString().slice(0, 10);
    triggerDownload(
      `auradesk-reports-${today}.json`,
      JSON.stringify(report, null, 2),
      "application/json"
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-50 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-sky-400" />
            {t("reports.title")}
          </h2>
          <p className="text-xs text-slate-400 mt-1">{t("reports.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!report}
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg aura-glass-pill px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-sky-300 disabled:opacity-40 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            {t("reports.exportCsv")}
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={exportJson}
            className="inline-flex items-center gap-1.5 rounded-lg aura-glass-pill px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-sky-300 disabled:opacity-40 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            {t("reports.exportJson")}
          </button>
        </div>
      </div>

      {/* Period Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            key: "today",
            accentClass: "border-t-2 border-t-sky-400/75",
            titleColor: "text-sky-400",
            title: t("reports.today"),
            focusMin: report?.today.focusMin ?? 0,
            breakMin: report?.today.breakMin ?? 0,
            waterCount: report?.today.waterCount ?? 0,
            tasksDone: report?.today.tasksDone ?? 0,
            pomodoros: report?.today.pomodoros ?? 0,
            activeDays: undefined,
          },
          {
            key: "week",
            accentClass: "border-t-2 border-t-indigo-400/75",
            titleColor: "text-indigo-400",
            title: t("reports.week"),
            ...(report?.week ?? {
              focusMin: 0,
              breakMin: 0,
              waterCount: 0,
              tasksDone: 0,
              pomodoros: 0,
              activeDays: 0,
            }),
          },
          {
            key: "month",
            accentClass: "border-t-2 border-t-emerald-400/75",
            titleColor: "text-emerald-400",
            title: t("reports.month"),
            ...(report?.month ?? {
              focusMin: 0,
              breakMin: 0,
              waterCount: 0,
              tasksDone: 0,
              pomodoros: 0,
              activeDays: 0,
            }),
          },
        ].map((card) => {
          const totalRatioMin = card.focusMin + card.breakMin;
          const focusPct = totalRatioMin > 0 ? Math.round((card.focusMin / totalRatioMin) * 100) : 0;
          return (
            <div
              key={card.key}
              className={`rounded-2xl aura-glass aura-card-interactive ${card.accentClass} p-5 space-y-3`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold uppercase tracking-wider ${card.titleColor}`}>
                  {card.title}
                </span>
                {card.activeDays !== undefined && (
                  <span className="rounded-full aura-glass-pill px-2 py-0.5 text-[10px] font-medium text-slate-300">
                    {card.activeDays} {t("reports.activeDays")}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl aura-glass-pill p-2.5">
                  <div className="text-slate-400 flex items-center gap-1.5">
                    <span className="rounded-md bg-sky-500/15 p-1">
                      <Flame className="h-3 w-3 text-sky-400" />
                    </span>
                    {t("reports.focusLabel")}
                  </div>
                  <div className="text-lg font-bold text-slate-100 tabular-nums mt-1">
                    {card.focusMin}m
                  </div>
                </div>
                <div className="rounded-xl aura-glass-pill p-2.5">
                  <div className="text-slate-400 flex items-center gap-1.5">
                    <span className="rounded-md bg-indigo-500/15 p-1">
                      <Timer className="h-3 w-3 text-indigo-400" />
                    </span>
                    {t("reports.breakLabel")}
                  </div>
                  <div className="text-lg font-bold text-slate-100 tabular-nums mt-1">
                    {card.breakMin}m
                  </div>
                </div>
                <div className="rounded-xl aura-glass-pill p-2.5">
                  <div className="text-slate-400 flex items-center gap-1.5">
                    <span className="rounded-md bg-emerald-500/15 p-1">
                      <Droplets className="h-3 w-3 text-emerald-400" />
                    </span>
                    {t("reports.waterLabel")}
                  </div>
                  <div className="text-lg font-bold text-emerald-300 tabular-nums mt-1">
                    {card.waterCount}
                  </div>
                </div>
                <div className="rounded-xl aura-glass-pill p-2.5">
                  <div className="text-slate-400 flex items-center gap-1.5">
                    <span className="rounded-md bg-amber-500/15 p-1">
                      <CheckCircle2 className="h-3 w-3 text-amber-400" />
                    </span>
                    {t("reports.tasksLabel")}
                  </div>
                  <div className="text-lg font-bold text-amber-300 tabular-nums mt-1">
                    {card.tasksDone}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5 rounded-xl aura-glass-pill px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{t("reports.pomodorosLabel")}</span>
                  <span className="font-bold text-sky-300 tabular-nums">{card.pomodoros}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80 flex">
                  <div
                    className="h-full bg-sky-400 transition-all"
                    style={{ width: `${focusPct}%` }}
                  />
                  {totalRatioMin > 0 && (
                    <div
                      className="h-full bg-indigo-400/80 transition-all"
                      style={{ width: `${100 - focusPct}%` }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 14-Day Focus, Break, Hydration & Tasks Chart */}
      <div className="rounded-2xl aura-glass p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-100">
            {t("reports.dailyChartTitle")}
          </h3>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-sky-400" />
              {t("reports.focusLabel")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-indigo-400" />
              {t("reports.breakLabel")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />
              {t("reports.waterLabel")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />
              {t("reports.tasksLabel")}
            </span>
          </div>
        </div>

        {days.length === 0 ? (
          <p className="text-xs text-slate-500 py-8 text-center">{t("reports.noData")}</p>
        ) : (
          <div className="w-full overflow-x-auto">
            <svg
              data-testid="reports-chart"
              viewBox={`0 0 ${days.length * 46} 180`}
              role="img"
              aria-label={t("reports.dailyChartTitle")}
              className="w-full min-w-[560px] h-52"
            >
              {[50, 80, 110].map((yPos) => (
                <line
                  key={yPos}
                  x1={0}
                  x2={days.length * 46}
                  y1={yPos}
                  y2={yPos}
                  stroke="rgba(148, 163, 184, 0.16)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              ))}
              <line
                x1={0}
                x2={days.length * 46}
                y1={140}
                y2={140}
                stroke="rgba(148, 163, 184, 0.3)"
                strokeWidth={1}
              />
              {days.map((d, idx) => {
                const xBase = idx * 46 + 8;
                const focusH = Math.max(2, Math.round((d.focusMin / maxMinutes) * 120));
                const breakH = Math.max(2, Math.round((d.breakMin / maxMinutes) * 120));
                const label = d.date.slice(5);
                return (
                  <g key={d.date}>
                    <title>
                      {`${d.date}: ${d.focusMin}m focus, ${d.breakMin}m break, ${d.waterCount} water, ${d.tasksDone} tasks`}
                    </title>
                    <rect
                      x={xBase}
                      y={140 - focusH}
                      width={12}
                      height={focusH}
                      rx={3}
                      className="fill-sky-400"
                    />
                    <rect
                      x={xBase + 15}
                      y={140 - breakH}
                      width={12}
                      height={breakH}
                      rx={3}
                      className="fill-indigo-400"
                    />
                    <text
                      x={xBase + 13}
                      y={158}
                      textAnchor="middle"
                      className="fill-slate-400 text-[9px]"
                    >
                      {label}
                    </text>
                    <text
                      x={xBase + 6}
                      y={172}
                      textAnchor="middle"
                      className="fill-emerald-400 text-[9px]"
                    >
                      {d.waterCount}💧
                    </text>
                    <text
                      x={xBase + 22}
                      y={172}
                      textAnchor="middle"
                      className="fill-amber-400 text-[9px]"
                    >
                      {d.tasksDone}✓
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

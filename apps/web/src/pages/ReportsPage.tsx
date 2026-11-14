import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, CheckCircle2, Droplets, Flame, Timer } from "lucide-react";

import { reportsApi, type ReportSummary } from "../lib/ipc";

export interface ReportsPageProps {
  initialReport?: ReportSummary | null;
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-50 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-sky-400" />
          {t("reports.title")}
        </h2>
        <p className="text-xs text-slate-400 mt-1">{t("reports.subtitle")}</p>
      </div>

      {/* Period Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            key: "today",
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
        ].map((card) => (
          <div
            key={card.key}
            className="rounded-xl bg-slate-900/60 p-4 ring-1 ring-slate-800/80 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                {card.title}
              </span>
              {card.activeDays !== undefined && (
                <span className="text-[11px] text-slate-400">
                  {card.activeDays} {t("reports.activeDays")}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-lg bg-slate-950/70 p-2.5 ring-1 ring-slate-800/70">
                <div className="text-slate-400 flex items-center gap-1">
                  <Flame className="h-3 w-3 text-sky-400" />
                  {t("reports.focusLabel")}
                </div>
                <div className="text-lg font-bold text-slate-100 tabular-nums mt-0.5">
                  {card.focusMin}m
                </div>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-2.5 ring-1 ring-slate-800/70">
                <div className="text-slate-400 flex items-center gap-1">
                  <Timer className="h-3 w-3 text-indigo-400" />
                  {t("reports.breakLabel")}
                </div>
                <div className="text-lg font-bold text-slate-100 tabular-nums mt-0.5">
                  {card.breakMin}m
                </div>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-2.5 ring-1 ring-slate-800/70">
                <div className="text-slate-400 flex items-center gap-1">
                  <Droplets className="h-3 w-3 text-emerald-400" />
                  {t("reports.waterLabel")}
                </div>
                <div className="text-lg font-bold text-emerald-300 tabular-nums mt-0.5">
                  {card.waterCount}
                </div>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-2.5 ring-1 ring-slate-800/70">
                <div className="text-slate-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-amber-400" />
                  {t("reports.tasksLabel")}
                </div>
                <div className="text-lg font-bold text-amber-300 tabular-nums mt-0.5">
                  {card.tasksDone}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 14-Day Focus, Break, Hydration & Tasks Chart */}
      <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-4">
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
              className="w-full min-w-[560px] h-48"
            >
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

import { useTranslation } from "react-i18next";

export function AppShell() {
  const { t, i18n } = useTranslation();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold">{t("app.title")}</h1>
      <p className="text-slate-400">AuraDesk — Phase 0 frontend skeleton</p>
      <div className="flex gap-2 mt-4">
        <button
          className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700"
          onClick={() => i18n.changeLanguage("pt-BR")}
        >
          pt-BR
        </button>
        <button
          className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700"
          onClick={() => i18n.changeLanguage("en")}
        >
          en
        </button>
      </div>
    </div>
  );
}

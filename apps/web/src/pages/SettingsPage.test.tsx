import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import i18n from "@/lib/i18n";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function openSettingsTab(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
}

describe("SettingsPage", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("pt-BR");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute("data-theme");
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "settings_get_all") return [];
      if (cmd === "desktop_list_monitors") {
        return [
          {
            name: "DP-1",
            width: 2560,
            height: 1440,
            x: 0,
            y: 0,
            scaleFactor: 1,
            isPrimary: true,
          },
          {
            name: "HDMI-1",
            width: 1920,
            height: 1080,
            x: 2560,
            y: 0,
            scaleFactor: 1,
            isPrimary: false,
          },
        ];
      }
      if (cmd === "desktop_apply_monitor_preference") return "placed:HDMI-1";
      return undefined;
    });
  });

  it("renders subgroup navbar and isolates each subgroup panel without stacking all sections", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_get_all", undefined);
    });

    const tablist = screen.getByRole("tablist", { name: /Subgrupos de configurações/i });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(8);

    // Initially only "general" (Aplicativo + Aparência) is visible
    expect(screen.getByText("Aplicativo")).toBeInTheDocument();
    expect(screen.getByText("Aparência & Liquid Glass")).toBeInTheDocument();
    expect(screen.queryByText("Desktop & Multi-Monitor")).not.toBeInTheDocument();
    expect(screen.queryByText("Pomodoro")).not.toBeInTheDocument();
    expect(screen.queryByText("GitHub Issues")).not.toBeInTheDocument();
    expect(screen.queryByText("Backup & Portabilidade")).not.toBeInTheDocument();

    openSettingsTab("settings-tab-desktop");
    expect(screen.getByText("Desktop & Multi-Monitor")).toBeInTheDocument();
    expect(screen.queryByText("Aplicativo")).not.toBeInTheDocument();

    openSettingsTab("settings-tab-focus");
    expect(screen.getByText("Pomodoro")).toBeInTheDocument();
    expect(screen.getByText("Rotinas")).toBeInTheDocument();
    expect(screen.getByLabelText("Intervalo de hidratação (min)")).toHaveValue(60);
    expect(screen.getByLabelText("Intervalo de pausa (min)")).toHaveValue(90);

    openSettingsTab("settings-tab-reminders");
    expect(screen.getByText("Lembretes")).toBeInTheDocument();
    expect(screen.getByLabelText("Bloquear PC até confirmar leitura")).toHaveAttribute(
      "aria-checked",
      "false"
    );

    openSettingsTab("settings-tab-ai");
    expect(screen.getByText("Aura IA & Provedores")).toBeInTheDocument();
    expect(screen.getByText("GitHub Issues")).toBeInTheDocument();

    openSettingsTab("settings-tab-hindsight");
    expect(screen.getByLabelText(/Hindsight — Cérebro de Memória/i)).toBeInTheDocument();

    openSettingsTab("settings-tab-raglight");
    expect(screen.getByLabelText(/RAGLight — Banco de Arquivos/i)).toBeInTheDocument();

    openSettingsTab("settings-tab-system");
    expect(screen.getByText("Atualizações & Logs de Crash")).toBeInTheDocument();
    expect(screen.getByText("Backup & Portabilidade")).toBeInTheDocument();
  });

  it("allows changing number values, shows unsaved badge, and saves them", async () => {
    render(<SettingsPage initialSection="focus" />);

    const focusInput = screen.getByLabelText("Foco (min)");
    expect(focusInput).toHaveValue(25);

    fireEvent.change(focusInput, { target: { value: "30" } });
    expect(focusInput).toHaveValue(30);
    expect(screen.getByText("Não salvo")).toBeInTheDocument();
    expect(
      screen.getByTestId("settings-tab-focus").querySelector('[title="Não salvo"]')
    ).toBeInTheDocument();

    const focusForm = focusInput.closest("form");
    expect(focusForm).not.toBeNull();
    fireEvent.submit(focusForm!);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
        input: {
          key: "pomodoro.focus_min",
          value: 30,
        },
      });
    });

    expect(await screen.findByText(/✓ (Salvo|Saved)/i)).toBeInTheDocument();
    expect(screen.queryByText("Não salvo")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("settings-tab-focus").querySelector('[title="Não salvo"]')
    ).not.toBeInTheDocument();
  });

  it("auto-saves boolean switches including reminders.block_screen", async () => {
    render(<SettingsPage />);

    openSettingsTab("settings-tab-reminders");
    const blockToggle = screen.getByLabelText("Bloquear PC até confirmar leitura");
    expect(blockToggle).toHaveAttribute("role", "switch");
    fireEvent.click(blockToggle);
    expect(blockToggle).toHaveAttribute("aria-checked", "true");

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
        input: {
          key: "reminders.block_screen",
          value: true,
        },
      });
    });

    openSettingsTab("settings-tab-desktop");
    const autostartToggle = screen.getByLabelText("Iniciar com o sistema");
    fireEvent.click(autostartToggle);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("desktop_set_autostart", { enabled: true });
    });

    const compactToggle = screen.getByLabelText("Widget compacto flutuante");
    fireEvent.click(compactToggle);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("desktop_toggle_compact", { enabled: true });
    });
  });

  it("auto-saves select changes and preserves light theme when changing preset", async () => {
    render(<SettingsPage />);

    const themeSelect = screen.getByLabelText("Tema");
    fireEvent.change(themeSelect, { target: { value: "light" } });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
        input: {
          key: "app.theme",
          value: "light",
        },
      });
    });
    expect(document.documentElement.dataset.theme).toBe("light");

    const presetSelect = screen.getByLabelText("Preset de Tema Glass");
    fireEvent.change(presetSelect, { target: { value: "emerald" } });
    expect(document.documentElement.dataset.preset).toBe("emerald");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("surfaces error even when app.locale rejects", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "settings_get_all") return [];
      throw new Error("Database lock conflict");
    });
    render(<SettingsPage />);

    const localeSelect = screen.getByLabelText("Idioma / Language");
    fireEvent.change(localeSelect, { target: { value: "en" } });

    expect(await screen.findByText(/Database lock conflict/i)).toBeInTheDocument();
  });

  it("triggers blocking modal test and zip export/import", async () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:test"),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    try {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "settings_get_all") return [];
        if (cmd === "alerts_trigger_test_block") return { id: "a-test" };
        if (cmd === "data_export_zip") return btoa("zip");
        if (cmd === "data_import_zip") {
          return {
            projects: 0,
            tasks: 3,
            pomodoros: 0,
            reminders: 0,
            daily_plans: 0,
            settings: 2,
            github_issues: 0,
          };
        }
        return undefined;
      });

      const onAlertTriggered = vi.fn();
      render(<SettingsPage onAlertTriggered={onAlertTriggered} />);

      openSettingsTab("settings-tab-reminders");
      fireEvent.click(screen.getByRole("button", { name: /Testar modal bloqueante/i }));
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("alerts_trigger_test_block", {
          title: "Teste do Modal Bloqueante",
          body: expect.any(String),
        });
      });
      expect(onAlertTriggered).toHaveBeenCalled();

      openSettingsTab("settings-tab-system");
      fireEvent.click(screen.getByRole("button", { name: /Exportar Backup/i }));
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("data_export_zip", undefined);
      });
      expect(anchorClickSpy).toHaveBeenCalled();

      const fileInput = screen.getByTestId("backup-zip-input") as HTMLInputElement;
      const fakeFile = new File([new Uint8Array([80, 75, 3, 4])], "backup.zip", {
        type: "application/zip",
      });
      Object.defineProperty(fakeFile, "arrayBuffer", {
        value: async () => new Uint8Array([80, 75, 3, 4]).buffer,
      });
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });

      // Confirmation dialog opens before destructive import executes
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(mockInvoke).not.toHaveBeenCalledWith("data_import_zip", expect.anything());

      fireEvent.click(screen.getByRole("button", { name: "Restaurar agora" }));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("data_import_zip", {
          zipBase64: expect.any(String),
        });
      });
    } finally {
      anchorClickSpy.mockRestore();
      Object.defineProperty(URL, "createObjectURL", {
        value: origCreate,
        configurable: true,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        value: origRevoke,
        configurable: true,
      });
    }
  });

  it("supports keyboard navigation across subgroup tabs and controls", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_get_all", undefined);
    });

    const generalTab = screen.getByTestId("settings-tab-general");
    const desktopTab = screen.getByTestId("settings-tab-desktop");

    await user.tab();
    expect(generalTab).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(desktopTab).toHaveFocus();
    expect(desktopTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Desktop & Multi-Monitor")).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(generalTab).toHaveFocus();
    expect(generalTab).toHaveAttribute("aria-selected", "true");

    const localeSelect = screen.getByLabelText("Idioma / Language");
    await user.tab();
    expect(localeSelect).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Tema")).toHaveFocus();
  });

  it("renders auto-update status, checks GitHub updates, and displays crash log tail", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "settings_get_all") return [];
      if (cmd === "desktop_list_monitors") return [];
      if (cmd === "updater_get_state") {
        return {
          status: "available",
          currentVersion: "0.2.1",
          latestVersion: "0.2.2",
          releaseNotes: "Auto updater ready",
          releaseUrl: "https://github.com/RGT-AI-Solutions/auradesk/releases/tag/v0.2.2",
          assetName: "AuraDesk_0.2.2_x64-setup.exe",
          progressPct: 0,
          autoUpdateEnabled: true,
          lastCheckedAt: "2026-11-18T10:00:00Z",
          downloadedPath: null,
          errorMessage: null,
        };
      }
      if (cmd === "app_get_logs_tail") {
        return ["[2026-11-18T10:00:00Z] auradesk starting v0.2.1"];
      }
      if (cmd === "updater_check_now") {
        return {
          status: "available",
          currentVersion: "0.2.1",
          latestVersion: "0.2.2",
          releaseNotes: "Auto updater ready",
          releaseUrl: "https://github.com/RGT-AI-Solutions/auradesk/releases/tag/v0.2.2",
          assetName: "AuraDesk_0.2.2_x64-setup.exe",
          progressPct: 0,
          autoUpdateEnabled: true,
          lastCheckedAt: "2026-11-18T10:05:00Z",
          downloadedPath: null,
          errorMessage: null,
        };
      }
      if (cmd === "app_open_logs_dir") {
        return "C:\\Users\\test\\AppData\\Roaming\\com.ragton.auradesk\\logs";
      }
      return undefined;
    });

    render(<SettingsPage />);

    expect(screen.getByLabelText("Atualizações automáticas")).toHaveAttribute(
      "aria-checked",
      "true"
    );

    await waitFor(() => {
      expect(
        screen
          .getByTestId("settings-tab-system")
          .querySelector('[title="Atualização v0.2.2 disponível."]')
      ).toBeInTheDocument();
    });

    openSettingsTab("settings-tab-system");

    expect(
      await screen.findByText(/\[2026-11-18T10:00:00Z\] auradesk starting v0\.2\.1/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Atualização v0\.2\.2 disponível/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Verificar atualizações/i }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_check_now", {
        autoInstall: false,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /Abrir pasta de logs/i }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("app_open_logs_dir", undefined);
    });
  });
});

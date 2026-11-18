import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import i18n from "@/lib/i18n";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

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

  it("renders all settings groups and updated defaults", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_get_all", undefined);
    });

    expect(screen.getByText("Aplicativo")).toBeInTheDocument();
    expect(screen.getByText("Desktop & Multi-Monitor")).toBeInTheDocument();
    expect(screen.getByText("Pomodoro")).toBeInTheDocument();
    expect(screen.getByText("Lembretes")).toBeInTheDocument();
    expect(screen.getByText("Rotinas")).toBeInTheDocument();
    expect(screen.getByText("GitHub Issues")).toBeInTheDocument();
    expect(screen.getByText("Backup & Portabilidade")).toBeInTheDocument();

    expect(screen.getByLabelText("Intervalo de hidratação (min)")).toHaveValue(60);
    expect(screen.getByLabelText("Intervalo de pausa (min)")).toHaveValue(90);
    expect(screen.getByLabelText("Bloquear PC até confirmar leitura")).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("allows changing number values, shows unsaved badge, and saves them", async () => {
    render(<SettingsPage />);

    const focusInput = screen.getByLabelText("Foco (min)");
    expect(focusInput).toHaveValue(25);

    fireEvent.change(focusInput, { target: { value: "30" } });
    expect(focusInput).toHaveValue(30);
    expect(screen.getByText("Não salvo")).toBeInTheDocument();

    const saveButtons = screen.getAllByRole("button", { name: "Salvar" });
    fireEvent.click(saveButtons[0]);

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
  });

  it("auto-saves boolean switches including reminders.block_screen", async () => {
    render(<SettingsPage />);

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

      fireEvent.click(screen.getByRole("button", { name: /Testar modal bloqueante/i }));
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("alerts_trigger_test_block", {
          title: "Teste do Modal Bloqueante",
          body: expect.any(String),
        });
      });
      expect(onAlertTriggered).toHaveBeenCalled();

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

  it("supports keyboard navigation (tabbing across controls)", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_get_all", undefined);
    });

    const localeSelect = screen.getByLabelText("Idioma / Language");
    await user.tab();
    expect(localeSelect).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Tema")).toHaveFocus();
  });
});

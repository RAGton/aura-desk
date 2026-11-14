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
      return undefined;
    });
  });

  it("renders all settings groups and updated defaults", async () => {
    render(<SettingsPage />);

    expect(screen.getByText("Aplicativo")).toBeInTheDocument();
    expect(screen.getByText("Pomodoro")).toBeInTheDocument();
    expect(screen.getByText("Lembretes")).toBeInTheDocument();
    expect(screen.getByText("Rotinas")).toBeInTheDocument();
    expect(screen.getByText("GitHub Issues")).toBeInTheDocument();
    expect(screen.getByText("Backup & Portabilidade")).toBeInTheDocument();

    expect(screen.getByLabelText("Intervalo de hidratação (min)")).toHaveValue(60);
    expect(screen.getByLabelText("Intervalo de pausa (min)")).toHaveValue(90);
    expect(screen.getByLabelText("Bloquear PC até confirmar leitura")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("allows changing number values and saving them", async () => {
    render(<SettingsPage />);

    const focusInput = screen.getByLabelText("Foco (min)");
    expect(focusInput).toHaveValue(25);

    fireEvent.change(focusInput, { target: { value: "30" } });
    expect(focusInput).toHaveValue(30);

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
  });

  it("auto-saves boolean toggles including reminders.block_screen", async () => {
    render(<SettingsPage />);

    const blockToggle = screen.getByLabelText("Bloquear PC até confirmar leitura");
    fireEvent.click(blockToggle);
    expect(blockToggle).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
        input: {
          key: "reminders.block_screen",
          value: true,
        },
      });
    });
  });

  it("auto-saves select changes and applies app.theme to documentElement", async () => {
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

      const fileInput = screen.getByTestId("backup-zip-input") as HTMLInputElement;
      const fakeFile = new File([new Uint8Array([80, 75, 3, 4])], "backup.zip", {
        type: "application/zip",
      });
      Object.defineProperty(fakeFile, "arrayBuffer", {
        value: async () => new Uint8Array([80, 75, 3, 4]).buffer,
      });
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("data_import_zip", {
          zipBase64: expect.any(String),
        });
      });
    } finally {
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

    const localeSelect = screen.getByLabelText("Idioma / Language");
    await user.tab();
    expect(localeSelect).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Tema")).toHaveFocus();
  });
});

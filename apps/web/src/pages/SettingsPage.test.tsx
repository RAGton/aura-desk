import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "settings_get_all") return [];
      return undefined;
    });
  });

  it("renders all settings groups and default options", async () => {
    render(<SettingsPage />);

    expect(screen.getByText("Aplicativo")).toBeInTheDocument();
    expect(screen.getByText("Pomodoro")).toBeInTheDocument();
    expect(screen.getByText("Lembretes")).toBeInTheDocument();
    expect(screen.getByText("Rotinas")).toBeInTheDocument();

    expect(screen.getByText("Idioma / Language")).toBeInTheDocument();
    expect(screen.getByText("Tema")).toBeInTheDocument();
    expect(screen.getByText("Foco (min)")).toBeInTheDocument();
    expect(screen.getByText("Intervalo de hidratação (min)")).toBeInTheDocument();
  });

  it("allows changing number values and saving them", async () => {
    render(<SettingsPage />);

    const numberInputs = screen.getAllByRole("spinbutton");
    const focusInput = numberInputs[0];
    expect(focusInput).toHaveValue(25);

    fireEvent.change(focusInput, { target: { value: "30" } });
    expect(focusInput).toHaveValue(30);

    const saveButtons = screen.getAllByRole("button", { name: "Salvar" });
    fireEvent.click(saveButtons[2]);

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

  it("allows toggling boolean settings and saving", async () => {
    render(<SettingsPage />);

    const toggleButtons = screen
      .getAllByRole("button")
      .filter((b: HTMLElement) => b.hasAttribute("aria-pressed"));
    expect(toggleButtons.length).toBeGreaterThan(0);
    const soundToggle = toggleButtons[0];
    expect(soundToggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(soundToggle);
    expect(soundToggle).toHaveAttribute("aria-pressed", "false");

    const saveButtons = screen.getAllByRole("button", { name: "Salvar" });
    fireEvent.click(saveButtons[6]);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
        input: {
          key: "reminders.sound",
          value: false,
        },
      });
    });
  });

  it("allows changing select settings (e.g. app.locale or app.theme)", async () => {
    render(<SettingsPage />);

    const selects = screen.getAllByRole("combobox");
    const localeSelect = selects[0];
    expect(localeSelect).toHaveValue("pt-BR");

    fireEvent.change(localeSelect, { target: { value: "en" } });
    expect(localeSelect).toHaveValue("en");

    const saveButtons = screen.getAllByRole("button", { name: "Salvar" });
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
        input: {
          key: "app.locale",
          value: "en",
        },
      });
    });
  });

  it("displays error message if settings_set rejects", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "settings_get_all") return [];
      throw new Error("Database lock conflict");
    });
    render(<SettingsPage />);

    const saveButtons = screen.getAllByRole("button", { name: "Salvar" });
    fireEvent.click(saveButtons[1]);

    expect(await screen.findByText(/Database lock conflict/i)).toBeInTheDocument();
  });

  it("supports keyboard navigation (tabbing across controls)", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    const selects = screen.getAllByRole("combobox");
    const firstSelect = selects[0];

    await user.tab();
    expect(firstSelect).toHaveFocus();

    await user.tab();
    const saveButtons = screen.getAllByRole("button", { name: "Salvar" });
    expect(saveButtons[0]).toHaveFocus();
  });
});

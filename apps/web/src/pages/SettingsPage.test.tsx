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
  });

  it("renders all settings groups and default options", async () => {
    render(<SettingsPage />);

    expect(screen.getByText("Aplicativo")).toBeInTheDocument();
    expect(screen.getByText("Pomodoro")).toBeInTheDocument();
    expect(screen.getByText("Lembretes")).toBeInTheDocument();
    expect(screen.getByText("Rotinas")).toBeInTheDocument();

    expect(screen.getByText("Idioma")).toBeInTheDocument();
    expect(screen.getByText("Tema")).toBeInTheDocument();
    expect(screen.getByText("Foco (min)")).toBeInTheDocument();
    expect(screen.getByText("Intervalo de hidratação (min)")).toBeInTheDocument();
  });

  it("allows changing number values and saving them", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    render(<SettingsPage />);

    // Foco (min) input default is 25
    const numberInputs = screen.getAllByRole("spinbutton");
    const focusInput = numberInputs[0];
    expect(focusInput).toHaveValue(25);

    fireEvent.change(focusInput, { target: { value: "30" } });
    expect(focusInput).toHaveValue(30);

    // Save button corresponding to focus input
    const saveButtons = screen.getAllByRole("button", { name: "Salvar" });
    fireEvent.click(saveButtons[2]); // index 2 corresponds to pomodoro.focus_min

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
        key: "pomodoro.focus_min",
        value: 30,
      });
    });

    expect(await screen.findByText(/✓ Salvo/i)).toBeInTheDocument();
  });

  it("allows toggling boolean settings and saving", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    render(<SettingsPage />);

    // Toggle button for reminders sound
    const toggleButtons = screen.getAllByRole("button").filter((b) =>
      b.hasAttribute("aria-pressed")
    );
    expect(toggleButtons.length).toBeGreaterThan(0);
    const soundToggle = toggleButtons[0];
    expect(soundToggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(soundToggle);
    expect(soundToggle).toHaveAttribute("aria-pressed", "false");

    // Click corresponding save button (pomodoro has 4 settings, app has 2, sound is 7th overall)
    const saveButtons = screen.getAllByRole("button", { name: "Salvar" });
    fireEvent.click(saveButtons[6]);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
        key: "reminders.sound",
        value: false,
      });
    });
  });

  it("allows changing select settings (e.g. app.locale or app.theme)", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
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
        key: "app.locale",
        value: "en",
      });
    });
  });

  it("displays error message if settings_set rejects", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Database lock conflict"));
    render(<SettingsPage />);

    const saveButtons = screen.getAllByRole("button", { name: "Salvar" });
    fireEvent.click(saveButtons[0]);

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

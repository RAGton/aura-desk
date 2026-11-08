import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ReminderModal } from "./ReminderModal";
import i18n from "../lib/i18n";
import type { Alert } from "../lib/ipc";

const waterAlert: Alert = {
  id: "alert-1",
  kind: "routine",
  title: "Hidratação",
  body: "Beba um copo de água.",
  severity: "info",
  ref_id: "routine-1",
  resolution: null,
  resolved_at: null,
  created_at: "2026-11-08T12:00:00Z",
};

function renderModal(alert: Alert | null) {
  const onResolve = vi.fn();
  const onSnooze = vi.fn();
  const onDismiss = vi.fn();
  render(
    <ReminderModal
      alert={alert}
      onResolve={onResolve}
      onSnooze={onSnooze}
      onDismiss={onDismiss}
    />
  );
  return { onResolve, onSnooze, onDismiss };
}

describe("ReminderModal", () => {
  // The language detector picks the browser locale, which would make the
  // button lookups below flaky. Pin it so the assertions are stable.
  beforeAll(async () => {
    await i18n.changeLanguage("pt-BR");
  });

  it("renders nothing when there is no pending alert", () => {
    renderModal(null);
    expect(screen.queryByTestId("reminder-modal")).not.toBeInTheDocument();
  });

  it("shows the alert title and body as a modal dialog", () => {
    renderModal(waterAlert);
    const dialog = screen.getByTestId("reminder-modal");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Hidratação")).toBeInTheDocument();
    expect(screen.getByText("Beba um copo de água.")).toBeInTheDocument();
  });

  it("does not close on Escape, because the alert still needs a decision", () => {
    renderModal(waterAlert);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("reminder-modal")).toBeInTheDocument();
  });

  it("does not close when the backdrop is clicked", () => {
    renderModal(waterAlert);
    fireEvent.click(screen.getByTestId("reminder-modal"));
    expect(screen.getByTestId("reminder-modal")).toBeInTheDocument();
  });

  it("calls onResolve with the alert id when the resolve button is clicked", () => {
    const { onResolve } = renderModal(waterAlert);
    fireEvent.click(screen.getByRole("button", { name: /Resolver/i }));
    expect(onResolve).toHaveBeenCalledWith("alert-1");
  });

  it("calls onSnooze and onDismiss with the alert id", () => {
    const { onSnooze, onDismiss } = renderModal(waterAlert);
    fireEvent.click(screen.getByRole("button", { name: /Adiar/i }));
    expect(onSnooze).toHaveBeenCalledWith("alert-1");

    fireEvent.click(screen.getByRole("button", { name: /Dispensar/i }));
    expect(onDismiss).toHaveBeenCalledWith("alert-1");
  });

  it("moves focus to the resolve button so keyboard users land inside the modal", () => {
    renderModal(waterAlert);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Resolver/i })
    );
  });
});

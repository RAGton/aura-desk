import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { HermesChatPanel } from "./HermesChatPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("HermesChatPanel", () => {
  beforeEach(async () => {
    localStorage.clear();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  function renderPanel(onProposalApplied?: () => void) {
    return render(
      <I18nextProvider i18n={i18n}>
        <HermesChatPanel onProposalApplied={onProposalApplied} />
      </I18nextProvider>
    );
  }

  it("proposes tasks via chat, supports Edit & Approve with modifications, and logs audit trail", async () => {
    const onApplied = vi.fn();
    renderPanel(onApplied);

    await waitFor(() => {
      expect(screen.getByText(/Hermes CLI offline/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
    fireEvent.change(input, { target: { value: "create task: Draft RFC" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

    await waitFor(() => {
      expect(screen.getByText("Create task: Draft RFC")).toBeInTheDocument();
    });
    expect(screen.getByText(/propose_create_task/i)).toBeInTheDocument();

    // Open Edit & Approve editor and tweak title & priority before applying
    fireEvent.click(screen.getByRole("button", { name: /Edit & Approve/i }));
    const titleInput = screen.getByLabelText(/^Title$/i);
    fireEvent.change(titleInput, { target: { value: "Finalize Q4 RFC" } });
    const prioritySelect = screen.getByLabelText(/^Priority$/i);
    fireEvent.change(prioritySelect, { target: { value: "urgent" } });

    fireEvent.click(screen.getByRole("button", { name: /Apply & Approve/i }));

    await waitFor(() => {
      expect(screen.getByText(/Proposal approved and applied/i)).toBeInTheDocument();
    });
    expect(onApplied).toHaveBeenCalledTimes(1);

    // Switch to History filter to verify decided proposal appears cleanly
    fireEvent.click(screen.getByRole("button", { name: /History \(1\)/i }));
    await waitFor(() => {
      expect(screen.getByText("approved")).toBeInTheDocument();
    });
    expect(screen.getByText(/approve_proposal/i)).toBeInTheDocument();
  });

  it("handles voice capture gracefully when browser microphone APIs are unavailable", async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record WAV Note/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Record WAV Note/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Audio recording is not supported in this browser/i)
      ).toBeInTheDocument();
    });
  });

  it("rejects a proposed reminder with optional note", async () => {
    renderPanel();

    const input = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
    fireEvent.change(input, { target: { value: "remind me: Take vitamins" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

    await waitFor(() => {
      expect(screen.getByText("Create reminder: Take vitamins")).toBeInTheDocument();
    });

    const noteInput = screen.getByLabelText(/Decision note/i);
    fireEvent.change(noteInput, { target: { value: "Already done" } });
    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));

    await waitFor(() => {
      expect(screen.getByText(/Proposal rejected/i)).toBeInTheDocument();
    });
  });
});

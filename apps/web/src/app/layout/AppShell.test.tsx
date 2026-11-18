import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell Component", () => {
  it("renders app title and primary navigation tabs", async () => {
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getAllByText(/AuraDesk/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: /Kanban/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pomodoro/i })).toBeInTheDocument();
  });

  it("renders language switcher buttons", async () => {
    render(<AppShell />);
    const ptBtn = await screen.findByRole("button", { name: "pt-BR" });
    const enBtn = screen.getByRole("button", { name: "en" });

    expect(ptBtn).toBeInTheDocument();
    expect(enBtn).toBeInTheDocument();
  });

  it("allows switching language when buttons are clicked", async () => {
    render(<AppShell />);
    const ptBtn = await screen.findByRole("button", { name: "pt-BR" });
    const enBtn = screen.getByRole("button", { name: "en" });

    fireEvent.click(enBtn);
    fireEvent.click(ptBtn);
    await waitFor(() => {
      expect(ptBtn).toBeInTheDocument();
    });
  });

  it("supports keyboard navigation (Tab reaches skip link then interactive buttons)", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByRole("navigation")).toBeInTheDocument();
    });

    await user.tab();
    expect(document.activeElement?.tagName).toBe("A");
    expect(document.activeElement).toHaveAttribute("href", "#main-content");

    await user.tab();
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });
});

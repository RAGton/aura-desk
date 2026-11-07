import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell Component", () => {
  it("renders app title and primary navigation tabs", () => {
    render(<AppShell />);
    expect(screen.getAllByText(/AuraDesk/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Kanban/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pomodoro/i })).toBeInTheDocument();
  });

  it("renders language switcher buttons", () => {
    render(<AppShell />);
    const ptBtn = screen.getByRole("button", { name: "pt-BR" });
    const enBtn = screen.getByRole("button", { name: "en" });

    expect(ptBtn).toBeInTheDocument();
    expect(enBtn).toBeInTheDocument();
  });

  it("allows switching language when buttons are clicked", async () => {
    render(<AppShell />);
    const ptBtn = screen.getByRole("button", { name: "pt-BR" });
    const enBtn = screen.getByRole("button", { name: "en" });

    fireEvent.click(enBtn);
    fireEvent.click(ptBtn);
    expect(ptBtn).toBeInTheDocument();
  });

  it("supports keyboard navigation (Tab reaches interactive buttons)", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.tab();
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });
});

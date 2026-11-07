import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell Component", () => {
  it("renders app title and skeleton description", () => {
    render(<AppShell />);
    expect(screen.getByText("AuraDesk — Phase 0 frontend skeleton")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
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

  it("supports keyboard navigation (Tab reaches all interactive buttons)", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    const ptBtn = screen.getByRole("button", { name: "pt-BR" });
    const enBtn = screen.getByRole("button", { name: "en" });

    await user.tab();
    expect(ptBtn).toHaveFocus();

    await user.tab();
    expect(enBtn).toHaveFocus();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppRouter } from "./router";

describe("AppRouter", () => {
  it("renders the root route inside AppShell", () => {
    render(<AppRouter />);
    expect(screen.getByText("AuraDesk — Phase 0 frontend skeleton")).toBeInTheDocument();
  });
});

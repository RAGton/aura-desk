import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppRouter } from "./router";

describe("AppRouter", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("renders the root route inside AppShell", () => {
    render(<AppRouter />);
    expect(screen.getAllByText(/AuraDesk/i).length).toBeGreaterThan(0);
  });

  it("renders AlertLockPage directly when ?view=alert-popup or ?view=alert-lock is present", () => {
    window.history.replaceState(null, "", "/index.html?view=alert-lock&backdrop=1");
    const { unmount } = render(<AppRouter />);
    expect(screen.getByTestId("alert-lock-backdrop")).toBeTruthy();
    unmount();

    window.history.replaceState(null, "", "/index.html?view=alert-popup");
    const { container } = render(<AppRouter />);
    expect(screen.queryByRole("banner")).toBeNull();
    expect(container.querySelector(".aura-bg.overflow-hidden")).toBeTruthy();
  });
});

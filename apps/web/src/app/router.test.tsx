import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppRouter } from "./router";

describe("AppRouter", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    delete (window as unknown as { __AURADESK_WINDOW_MODE__?: string }).__AURADESK_WINDOW_MODE__;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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

  it("detects alert-popup and alert-lock backdrops via __AURADESK_WINDOW_MODE__ and Tauri window label", () => {
    const win = window as unknown as {
      __AURADESK_WINDOW_MODE__?: string;
      __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
    };

    win.__AURADESK_WINDOW_MODE__ = "alert-popup";
    const { container, unmount } = render(<AppRouter />);
    expect(screen.queryByRole("banner")).toBeNull();
    expect(container.querySelector(".aura-bg.overflow-hidden")).toBeTruthy();
    unmount();

    win.__AURADESK_WINDOW_MODE__ = "alert-lock-backdrop";
    const { unmount: unmountBackdrop } = render(<AppRouter />);
    expect(screen.getByTestId("alert-lock-backdrop")).toBeTruthy();
    unmountBackdrop();

    delete win.__AURADESK_WINDOW_MODE__;
    win.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "alert-lock-0" } } };
    const { unmount: unmountLabelBackdrop } = render(<AppRouter />);
    expect(screen.getByTestId("alert-lock-backdrop")).toBeTruthy();
    unmountLabelBackdrop();

    win.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "alert-popup" } } };
    const { container: labelPopupContainer } = render(<AppRouter />);
    expect(screen.queryByRole("banner")).toBeNull();
    expect(labelPopupContainer.querySelector(".aura-bg.overflow-hidden")).toBeTruthy();
  });
});

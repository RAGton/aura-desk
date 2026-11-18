import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppRouter } from "./router";

describe("AppRouter", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    delete (window as unknown as { __AURADESK_WINDOW_MODE__?: string }).__AURADESK_WINDOW_MODE__;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("renders the root route inside AppShell", async () => {
    await act(async () => {
      render(<AppRouter />);
    });
    expect(screen.getAllByText(/AuraDesk/i).length).toBeGreaterThan(0);
  });

  it("renders AlertLockPage directly when ?view=alert-popup or ?view=alert-lock is present", async () => {
    window.history.replaceState(null, "", "/index.html?view=alert-lock&backdrop=1");
    let unmountBackdrop!: () => void;
    await act(async () => {
      ({ unmount: unmountBackdrop } = render(<AppRouter />));
    });
    expect(screen.getByTestId("alert-lock-backdrop")).toBeTruthy();
    unmountBackdrop();

    window.history.replaceState(null, "", "/index.html?view=alert-popup");
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<AppRouter />));
    });
    expect(screen.queryByRole("banner")).toBeNull();
    expect(container.querySelector(".aura-bg.overflow-hidden")).toBeTruthy();
  });

  it("detects alert-popup and alert-lock backdrops via __AURADESK_WINDOW_MODE__ and Tauri window label", async () => {
    const win = window as unknown as {
      __AURADESK_WINDOW_MODE__?: string;
      __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
    };

    win.__AURADESK_WINDOW_MODE__ = "alert-popup";
    let container!: HTMLElement;
    let unmount!: () => void;
    await act(async () => {
      ({ container, unmount } = render(<AppRouter />));
    });
    expect(screen.queryByRole("banner")).toBeNull();
    expect(container.querySelector(".aura-bg.overflow-hidden")).toBeTruthy();
    unmount();

    win.__AURADESK_WINDOW_MODE__ = "alert-lock-backdrop";
    let unmountBackdrop!: () => void;
    await act(async () => {
      ({ unmount: unmountBackdrop } = render(<AppRouter />));
    });
    expect(screen.getByTestId("alert-lock-backdrop")).toBeTruthy();
    unmountBackdrop();

    delete win.__AURADESK_WINDOW_MODE__;
    win.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "alert-lock-0" } } };
    let unmountLabelBackdrop!: () => void;
    await act(async () => {
      ({ unmount: unmountLabelBackdrop } = render(<AppRouter />));
    });
    expect(screen.getByTestId("alert-lock-backdrop")).toBeTruthy();
    unmountLabelBackdrop();

    win.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "alert-popup" } } };
    let labelPopupContainer!: HTMLElement;
    await act(async () => {
      ({ container: labelPopupContainer } = render(<AppRouter />));
    });
    expect(screen.queryByRole("banner")).toBeNull();
    expect(labelPopupContainer.querySelector(".aura-bg.overflow-hidden")).toBeTruthy();
  });
});

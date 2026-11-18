import { fireEvent, render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
  Toast,
} from "./index";

describe("Aura Design System primitives", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders Button variants and loading accessibility attributes", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="primary" size="md" onClick={onClick}>
        Save
      </Button>,
    );

    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button variant="danger" size="sm" loading onClick={onClick}>
        Deleting
      </Button>,
    );
    const loadingBtn = screen.getByRole("button", { name: "Deleting" });
    expect(loadingBtn).toBeDisabled();
    expect(loadingBtn).toHaveAttribute("aria-busy", "true");
  });

  it("renders Input with accessible label, hint, and error state", () => {
    const { rerender } = render(
      <Input label="Project name" hint="Shown on Kanban board" placeholder="Aura" />,
    );

    const input = screen.getByLabelText("Project name");
    expect(input).toHaveAttribute("aria-describedby");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("Shown on Kanban board")).toBeInTheDocument();

    rerender(<Input label="Project name" error="Required field" />);
    const errored = screen.getByLabelText("Project name");
    expect(errored).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Required field");
  });

  it("renders Badge variants cleanly", () => {
    render(<Badge variant="success">Synced</Badge>);
    expect(screen.getByText("Synced")).toBeInTheDocument();
  });

  it("handles Dialog open/close, Escape key, and backdrop clicks", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog
        open={false}
        onClose={onClose}
        title="Confirm action"
        description="Details here"
      >
        <p>Body</p>
      </Dialog>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <Dialog
        open
        onClose={onClose}
        title="Confirm action"
        description="Details here"
        footer={<Button variant="secondary">Cancel</Button>}
      >
        <p>Body</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Details here")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(2);

    // Click backdrop wrapper directly
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("renders Toast status/alert semantics and dismiss control", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Toast open message="Saved" variant="info" onClose={onClose} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<Toast open message="Failed" variant="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
  });

  it("renders Skeleton and EmptyState primitives", () => {
    const { container } = render(
      <div>
        <Skeleton lines={3} />
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title="No tasks yet"
          description="Create your first task to begin."
          action={<Button size="sm">New task</Button>}
        />
      </div>,
    );

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New task" })).toBeInTheDocument();
  });

  it("renders accessible Select, Textarea, and Switch primitives", () => {
    const onSelectChange = vi.fn();
    const onSwitchChange = vi.fn();
    render(
      <div>
        <Select label="Priority" error="Pick a valid option" onChange={onSelectChange}>
          <option value="low">Low</option>
          <option value="high">High</option>
        </Select>
        <Textarea label="Notes" hint="Optional details" placeholder="Type notes…" />
        <Switch aria-label="Mute sounds" checked={false} onCheckedChange={onSwitchChange} />
      </div>,
    );

    const select = screen.getByLabelText("Priority");
    expect(select).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(select, { target: { value: "high" } });
    expect(onSelectChange).toHaveBeenCalledTimes(1);

    const notes = screen.getByLabelText("Notes");
    expect(notes).toHaveAttribute("aria-describedby");

    const toggle = screen.getByRole("switch", { name: "Mute sounds" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(onSwitchChange).toHaveBeenCalledWith(true);
  });
});

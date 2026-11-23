import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "../../lib/i18n";
import { AuraMarkdownView } from "./AuraMarkdownView";

describe("AuraMarkdownView", () => {
  it("renders fenced code block with language and copy button", async () => {
    const markdown = "```bash\necho hello\n```";
    render(
      <I18nextProvider i18n={i18n}>
        <AuraMarkdownView content={markdown} />
      </I18nextProvider>
    );

    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("echo hello")).toBeInTheDocument();
    expect(screen.getByLabelText(/Copy code/i)).toBeInTheDocument();
  });

  it("renders bullet lists, bold text, and inline code", () => {
    const markdown = "Texto com **negrito** e `codigo inline`:\n- Item um\n- Item dois";
    render(
      <I18nextProvider i18n={i18n}>
        <AuraMarkdownView content={markdown} />
      </I18nextProvider>
    );

    expect(screen.getByText("negrito")).toBeInTheDocument();
    expect(screen.getByText("codigo inline")).toBeInTheDocument();
    expect(screen.getByText("Item um")).toBeInTheDocument();
    expect(screen.getByText("Item dois")).toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "../../test/testing-library";
import { MessageCard } from "./message-card";

describe("MessageCard", () => {
  it("collapses actions behind a kebab; no inline Copy/Retry/Hide in closed state", () => {
    const { container } = render(
      <MessageCard
        message={{
          id: "m1",
          role: "assistant",
          parts: [{ type: "text", text: "Hello world" }],
          createdAt: new Date().toISOString()
        }}
        onCopy={() => undefined}
        onRetry={() => undefined}
        onHide={() => undefined}
        onTask={() => undefined}
      />
    );

    expect(screen.getByText("Assistant")).toBeTruthy();
    // Kebab trigger is present (aria-label).
    expect(container.innerHTML.includes('aria-label="Message actions"')).toBe(true);
    // Menu is closed by default, so the old button labels are NOT in the
    // rendered markup.
    expect(container.innerHTML.includes(">Copy<")).toBe(false);
    expect(container.innerHTML.includes(">Retry<")).toBe(false);
    expect(container.innerHTML.includes(">Hide<")).toBe(false);
    expect(container.innerHTML.includes("Create Task")).toBe(false);
  });
});

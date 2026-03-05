import { describe, expect, it } from "vitest";
import { render, screen } from "../../test/testing-library";
import { MessageCard } from "./message-card";

describe("MessageCard", () => {
  it("renders assistant actions", () => {
    render(
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
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.getByText("Create Task")).toBeTruthy();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "../../test/testing-library";
import { ChatComposer } from "./chat-composer";

describe("ChatComposer", () => {
  it("renders the draft area and attachments", () => {
    render(
      <ChatComposer
        draft="Hello"
        attachments={[{ id: "a1", name: "notes.txt", mimeType: "text/plain", dataUrl: null }]}
        tasks={[]}
        agents={[]}
        onDraftChange={() => undefined}
        onSend={() => undefined}
        onAttach={() => undefined}
        onRemoveAttachment={() => undefined}
      />
    );

    expect(screen.getByPlaceholderText("Message OpenClaw — type / for commands, # for tasks, @ for agents")).toBeTruthy();
    expect(screen.getByText("notes.txt ×")).toBeTruthy();
  });
});

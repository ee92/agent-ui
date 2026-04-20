import type { MessageContentPart } from "../../../lib/types";
import { Markdown } from "../markdown";
import { ThinkingCard } from "./thinking-card";
import { ToolUseCard } from "./tool-use-card";

export function SubAgentTrace({ parts }: { parts: MessageContentPart[] }) {
  if (!parts || parts.length === 0) return null;
  return (
    <div className="my-2 space-y-2 border-l-2 border-white/[0.08] pl-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">↳ Agent</div>
      {parts.map((part, index) => {
        if (part.type === "text") {
          return <Markdown key={`sub-text-${index}`} text={part.text || " "} />;
        }
        if (part.type === "thinking") {
          return <ThinkingCard key={`sub-think-${index}`} part={part} />;
        }
        if (part.type === "tool_use") {
          return (
            <div key={`sub-tool-${index}-${part.id}`} className="space-y-2">
              <ToolUseCard part={part} />
              {part.name === "Agent" && part.subAgentParts && part.subAgentParts.length > 0 ? (
                <SubAgentTrace parts={part.subAgentParts} />
              ) : null}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

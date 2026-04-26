import type { MessageContentPart } from "../../../lib/types";
import { ToolLogRow, statusFor } from "./tool-log-row";

type ToolUsePart = Extract<MessageContentPart, { type: "tool_use" }>;

// Groups a run of consecutive tool_use parts under a single left rail. The
// first currently-running tool in the group is auto-expanded; the rest stay
// collapsed. Completed tools render as compact log rows — click any row to
// inspect its input + result.
export function ToolLogGroup({ parts }: { parts: ToolUsePart[] }) {
  if (parts.length === 0) return null;
  // Only the *first* in-flight tool gets the default-expanded treatment. In
  // practice Claude runs tools serially so there's only ever one at a time,
  // but this keeps us defensive if the event order ever changes.
  let autoExpandedGiven = false;

  return (
    <div className="space-y-0 border-l border-white/[0.06] pl-3">
      {parts.map((part) => {
        const status = statusFor(part);
        const isBusy = status === "streaming" || status === "running";
        const defaultExpanded = isBusy && !autoExpandedGiven;
        if (defaultExpanded) autoExpandedGiven = true;
        return (
          <ToolLogRow
            key={`tool-${part.id}`}
            part={part}
            defaultExpanded={defaultExpanded}
          />
        );
      })}
    </div>
  );
}

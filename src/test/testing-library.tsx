import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let lastMarkup = "";

function assertContains(kind: string, value: string) {
  if (!lastMarkup.includes(value)) {
    throw new Error(`${kind} not found: ${value}\n${lastMarkup}`);
  }
  return { textContent: value };
}

export function render(element: ReactElement) {
  lastMarkup = renderToStaticMarkup(element);
  return {
    container: {
      get innerHTML() {
        return lastMarkup;
      }
    },
    rerender(next: ReactElement) {
      lastMarkup = renderToStaticMarkup(next);
    }
  };
}

export const screen = {
  getByText(value: string | RegExp) {
    const text = typeof value === "string" ? value : value.source;
    return assertContains("text", text.replace(/\\/g, ""));
  },
  getByPlaceholderText(value: string) {
    return assertContains("placeholder", value);
  }
};

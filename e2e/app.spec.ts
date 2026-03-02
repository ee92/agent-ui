import { expect, test } from "@playwright/test";

const BASE = "http://127.0.0.1:18789";

async function waitForApp(page: import("@playwright/test").Page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => {
      const text = document.body.innerText;
      // App is ready when: not showing connecting state AND has actual content
      const connecting = text.includes("connecting") && !text.includes("reconnecting");
      const hasContent = document.getElementById("root")!.innerHTML.length > 2000;
      return hasContent && !connecting;
    });
    if (ready) return;
    await page.waitForTimeout(500);
  }
  throw new Error("App did not become ready within timeout");
}

test("full app smoke test (mobile)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitForApp(page);

  // No JS crashes
  expect(errors).toHaveLength(0);

  // Composer visible without scrolling
  const composerVisible = await page.evaluate(() => {
    for (const el of document.querySelectorAll("textarea, input")) {
      const input = el as HTMLInputElement;
      if (input.placeholder?.includes("Message")) {
        const rect = input.getBoundingClientRect();
        if (rect.bottom <= window.innerHeight && rect.top >= 0) return true;
      }
    }
    return false;
  });
  expect(composerVisible).toBe(true);

  // Bottom nav visible
  const navVisible = await page.evaluate(() => {
    const nav = document.querySelector("nav");
    return nav ? nav.getBoundingClientRect().height > 0 : false;
  });
  expect(navVisible).toBe(true);

  // Switch to Tasks tab
  await page.getByLabel("Tasks").click();
  await page.waitForTimeout(1500);
  let bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).toContain("Add a task");

  // Add a task
  const taskTitle = "E2E-" + Date.now();
  await page.getByPlaceholder("Add a task...").fill(taskTitle);
  await page.getByPlaceholder("Add a task...").press("Enter");
  await page.waitForTimeout(1500);
  bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).toContain(taskTitle);

  // Filter pills — Done should hide our todo task
  await page.getByText("Done", { exact: true }).click();
  await page.waitForTimeout(500);
  bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).not.toContain(taskTitle);
  await page.getByText("All", { exact: true }).click();

  // Switch to Files tab
  await page.getByLabel("Files").click();
  await page.waitForTimeout(1500);
  bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText.includes("AGENTS") || bodyText.includes("memory") || bodyText.includes("Workspace")).toBe(true);

  // Back to Chat — composer still visible
  await page.getByLabel("Chat").click();
  await page.waitForTimeout(1000);
  const composerStill = await page.evaluate(() => {
    for (const el of document.querySelectorAll("textarea, input")) {
      const input = el as HTMLInputElement;
      if (input.placeholder?.includes("Message")) {
        const rect = input.getBoundingClientRect();
        if (rect.bottom <= window.innerHeight && rect.top >= 0) return true;
      }
    }
    return false;
  });
  expect(composerStill).toBe(true);

  // Open sidebar — should show conversations
  await page.getByLabel("Open sidebar").click();
  await page.waitForTimeout(500);
  bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText.includes("New Chat") || bodyText.includes("Main session")).toBe(true);

  // Session key persisted to localStorage
  const savedKey = await page.evaluate(() => localStorage.getItem("openclaw-ui-selected-conversation"));
  expect(savedKey).toBeTruthy();

  await ctx.close();
});

test("session persistence across reload", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitForApp(page);

  // Wait for sessions to load and auto-select
  await page.waitForTimeout(3000);
  const savedKey = await page.evaluate(() => localStorage.getItem("openclaw-ui-selected-conversation"));
  if (!savedKey) {
    test.skip();
    return;
  }

  await page.reload({ waitUntil: "networkidle" });
  await waitForApp(page);
  await page.waitForTimeout(3000);

  const restoredKey = await page.evaluate(() => localStorage.getItem("openclaw-ui-selected-conversation"));
  expect(restoredKey).toBe(savedKey);

  // Should have loaded messages (root content length > empty state)
  const rootLen = await page.evaluate(() => document.getElementById("root")!.innerHTML.length);
  expect(rootLen).toBeGreaterThan(5000);
});

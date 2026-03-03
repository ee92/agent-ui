import { expect, test } from "@playwright/test";

const BASE = "http://127.0.0.1:18789";

async function waitForApp(page: import("@playwright/test").Page) {
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => {
      const root = document.getElementById("root");
      return root ? root.innerHTML.length > 2000 : false;
    });
    if (ready) return;
    await page.waitForTimeout(500);
  }
}

// Single comprehensive test to minimize WS connections
test("mobile smoke test", async ({ browser }) => {
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
  expect(await page.evaluate(() => {
    const nav = document.querySelector("nav");
    return nav ? nav.getBoundingClientRect().height > 0 : false;
  })).toBe(true);

  // Tasks tab — filter pills visible
  await page.locator('nav button[aria-label="Tasks"]').click();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.body.innerText)).toContain("Review");

  // Files tab — workspace content visible
  await page.locator('nav button[aria-label="Files"]').click();
  await page.waitForTimeout(1500);
  const filesText = await page.evaluate(() => document.body.innerText);
  expect(filesText.includes("AGENTS") || filesText.includes("memory") || filesText.includes("Workspace")).toBe(true);

  // Back to Chat — composer still visible
  await page.locator('nav button[aria-label="Chat"]').click();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => {
    for (const el of document.querySelectorAll("textarea, input")) {
      const input = el as HTMLInputElement;
      if (input.placeholder?.includes("Message")) {
        const rect = input.getBoundingClientRect();
        if (rect.bottom <= window.innerHeight && rect.top >= 0) return true;
      }
    }
    return false;
  })).toBe(true);

  // Sidebar opens and shows conversations
  await page.getByLabel("Open sidebar").click();
  await page.waitForTimeout(500);
  const sidebarText = await page.evaluate(() => document.body.innerText);
  expect(sidebarText.includes("New Chat") || sidebarText.includes("Main session") || sidebarText.includes("Agent-main")).toBe(true);

  // Session key persisted
  expect(await page.evaluate(() => localStorage.getItem("openclaw-ui-selected-conversation"))).toBeTruthy();

  await ctx.close();
});

test("session persistence across reload", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitForApp(page);
  await page.waitForTimeout(3000);

  const savedKey = await page.evaluate(() => localStorage.getItem("openclaw-ui-selected-conversation"));
  if (!savedKey) { test.skip(); return; }

  await page.reload({ waitUntil: "networkidle" });
  await waitForApp(page);
  await page.waitForTimeout(3000);

  expect(await page.evaluate(() => localStorage.getItem("openclaw-ui-selected-conversation"))).toBe(savedKey);
  expect(await page.evaluate(() => document.getElementById("root")!.innerHTML.length)).toBeGreaterThan(5000);
});

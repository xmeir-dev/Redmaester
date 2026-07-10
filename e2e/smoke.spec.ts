import { test, expect } from "@playwright/test";

// Deliberately state-agnostic: the committed tree and the in-flight header /
// nav redesign (global-header, nav-tabs, topics page) render different
// navigation, so this asserts only the stable contract: the server boots,
// the home page renders interactive UI, and the console is clean. Tighten to
// named nav links (Bookmarks, Topics) once the redesign is committed.
test("home page renders with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);

  await expect(page.locator("a").first()).toBeVisible();

  expect(errors).toEqual([]);
});

import { test, expect } from "@playwright/test";

test("feedback is available on public, host, and guest pages without covering the phone navigation", async ({
  page,
  isMobile,
}) => {
  for (const path of [
    "/",
    "/demo",
    "/c/demo",
    "/session/demo",
    "/login",
    "/developers",
  ]) {
    await page.goto(path);
    const launcher = page.getByRole("button", {
      name: "Feedback",
      exact: true,
    });
    await expect(launcher).toBeVisible();
    if (isMobile && path === "/demo") {
      const button = await launcher.boundingBox();
      const nav = await page.locator(".mobile-nav").boundingBox();
      expect(button && nav && button.y + button.height < nav.y).toBe(true);
    }
    await launcher.click();
    const form = page.getByRole("dialog", { name: "Help Squid grow" });
    await expect(form).toBeVisible();
    await expect(form.getByRole("textbox", { name: "Email" })).toHaveValue("");
    await expect(
      form.getByRole("textbox", { name: "Email" }),
    ).not.toHaveAttribute("required");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await form.getByRole("button", { name: "Close dialog" }).click();
    await expect(form).not.toBeVisible();
  }
});

test("a failed submission keeps the draft and retries without duplicating feedback", async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/feedback", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: requests.length === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        requests.length === 1
          ? { error: "Could not send your feedback. Please try again." }
          : { ok: true },
      ),
    });
  });
  await page.goto("/c/demo");
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Help Squid grow" });
  await form
    .getByRole("textbox", { name: "Your feedback" })
    .fill("Setup instructions could be clearer.");
  await form.locator(".feedback-stars label").nth(3).click();
  await expect(form.getByRole("radio", { name: "4 — Good" })).toBeChecked();
  await form.getByRole("button", { name: "Send feedback" }).click();
  await expect(form.getByRole("alert")).toContainText("Could not send");
  await expect(
    form.getByRole("textbox", { name: "Your feedback" }),
  ).toHaveValue("Setup instructions could be clearer.");
  await form.getByRole("button", { name: "Send feedback" }).click();
  await expect(
    form.getByRole("heading", { name: "Thanks for helping Squid grow." }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({ rating: 4, email: "", page: "/c/demo" });
  await form.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await expect(
    form.getByRole("textbox", { name: "Your feedback" }),
  ).toHaveValue("");
});

test("feedback opens from an existing dialog and returns focus to that dialog", async ({
  page,
}) => {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "QR sticker", exact: true })
    .first()
    .click();
  const parent = page.getByRole("dialog").first();
  await parent.getByRole("button", { name: "Help Squid grow" }).click();
  const form = page.getByRole("dialog", { name: "Help Squid grow" });
  await expect(form).toBeVisible();
  await form
    .getByRole("textbox", { name: "Your feedback" })
    .fill("The sticker preview is helpful.");
  await form.getByRole("button", { name: "Close dialog" }).click();
  await expect(parent).toBeVisible();
  await expect(
    parent.getByRole("button", { name: "Help Squid grow" }),
  ).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );
  await parent.getByRole("button", { name: "Close dialog" }).click();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
});

test("leaving a page with nested dialogs restores scrolling", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Take a look around" }).click();
  await page
    .getByRole("button", { name: "QR sticker", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Help Squid grow" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Help Squid grow" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(
    process.env.E2E_BASE_URL || "http://localhost:3100",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
});

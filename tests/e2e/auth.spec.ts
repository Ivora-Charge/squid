import { test, expect } from "@playwright/test";
const origin = process.env.E2E_BASE_URL || "http://localhost:3100";
const password = "Example test password 47!";

test("password sign-in is the default and opens the host workspace", async ({
  page,
}) => {
  const submissions: unknown[] = [];
  await page.route("**/auth/password", async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true}',
    });
  });
  await page.route("**/dashboard", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Host workspace</h1>",
    }),
  );
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("host@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page
    .getByRole("button", { name: "Sign in to Squid", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/dashboard`);
  expect(submissions).toEqual([{ email: "host@example.com", password }]);
});
test("signup, incorrect passwords, and recovery have clear outcomes", async ({
  page,
}) => {
  await page.route("**/auth/password", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: '{"error":"Email or password is incorrect."}',
    }),
  );
  const submissions: { path: string; body: unknown }[] = [];
  for (const path of ["signup", "recover"]) {
    await page.route(`**/auth/${path}`, async (route) => {
      submissions.push({ path, body: route.request().postDataJSON() });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, confirmationRequired: true }),
      });
    });
  }
  await page.goto("/login");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("host@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in to Squid", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "incorrect",
  );
  await page
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Send reset link", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  await page
    .getByRole("button", { name: "Back to sign in", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("confirmation link");
  expect(submissions).toEqual([
    { path: "recover", body: { email: "host@example.com" } },
    { path: "signup", body: { email: "host@example.com", password } },
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("Google starts only when chosen and returns failures to the form", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/auth/google", async (route) => {
    attempts++;
    await route.fulfill(
      attempts === 1
        ? {
            status: 503,
            contentType: "application/json",
            body: '{"error":"Google sign-in is not available yet. Please use email and password."}',
          }
        : {
            contentType: "application/json",
            body: JSON.stringify({
              url: `${origin}/auth/callback?error=access_denied`,
            }),
          },
    );
  });
  await page.goto("/login");
  expect(attempts).toBe(0);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "not available yet",
  );
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(`${origin}/login?error=auth`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Sign-in could not be completed",
  );
  expect(attempts).toBe(2);
});
test("reset links wait for a matching new password before consuming the token", async ({
  page,
}) => {
  const token = "b".repeat(64);
  const requests: { path: string; method: string; body: unknown }[] = [];
  for (const path of ["recover/confirm", "password"]) {
    await page.route(`**/auth/${path}`, async (route) => {
      requests.push({
        path,
        method: route.request().method(),
        body: route.request().postDataJSON(),
      });
      await route.fulfill({
        contentType: "application/json",
        body: '{"ok":true}',
      });
    });
  }
  await page.route("**/dashboard", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Host workspace</h1>",
    }),
  );
  await page.goto(`/login/reset#token_hash=${token}`);
  await expect(page).toHaveURL(`${origin}/login/reset`);
  expect(requests).toEqual([]);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("Different password 82!");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "don’t match",
  );
  expect(requests).toEqual([]);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(`${origin}/dashboard`);
  expect(requests).toEqual([
    { path: "recover/confirm", method: "POST", body: { token_hash: token } },
    { path: "password", method: "PATCH", body: { password } },
  ]);
});
test("anonymous callers cannot change passwords and hostile origins cannot start auth", async ({
  request,
}) => {
  expect(
    (
      await request.patch("/auth/password", {
        headers: { origin },
        data: { password },
      })
    ).status(),
  ).toBe(401);
  for (const path of [
    "password",
    "signup",
    "recover",
    "recover/confirm",
    "google",
  ]) {
    expect(
      (
        await request.post(`/auth/${path}`, {
          headers: { origin: "https://evil.example" },
          data: { email: "host@example.com", password },
        })
      ).status(),
    ).toBe(403);
  }
});

import { test, expect } from "@playwright/test";
const origin = process.env.E2E_BASE_URL || "http://localhost:3100";
test("host sign-in explains email delivery without sending real mail", async ({
  page,
}) => {
  const submissions: unknown[] = [];
  await page.route("**/auth/login", async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Email me a sign-in link instead" })
    .click();
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("host@example.com");
  await page.getByRole("button", { name: "Send me a sign-in link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  expect(submissions).toEqual([{ email: "host@example.com" }]);
});
test("email confirmation waits for the host and removes the token from the address bar", async ({
  page,
}) => {
  const token = "a".repeat(64);
  const submissions: unknown[] = [];
  await page.route("**/auth/confirm", async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error:
          "This sign-in link has expired or was already used. Please request a new one.",
      }),
    });
  });
  await page.goto(`/login/confirm#token_hash=${token}`);
  const button = page.getByRole("button", {
    name: "Sign in to Squid",
    exact: true,
  });
  await expect(button).toBeEnabled();
  await expect(page).toHaveURL(`${origin}/login/confirm`);
  expect(submissions).toEqual([]);
  await button.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "expired",
  );
  expect(submissions).toEqual([{ token_hash: token }]);
  await expect(
    page.getByRole("link", { name: "Request a new link" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("landing, host demo, and navigation are mobile friendly", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A little charge. A better stay." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Take a look around" }).click();
  await expect(
    page.getByRole("heading", { name: "Your place. Good energy." }),
  ).toBeVisible();
  await expect(
    page.getByText("Sample data, no real charges.", { exact: false }),
  ).toBeVisible();
  const nav = page.locator(isMobile ? ".mobile-nav" : ".sidebar");
  await nav
    .getByRole("button", {
      name: isMobile ? "Earnings" : "Earnings & payouts",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "94% for you. 6% keeps Squid swimming.",
    }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your host account" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("guest can preview pricing, charge, and receive a demo receipt without real APIs", async ({
  page,
}) => {
  const externalWrites: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      (/\/api\/(checkout|sessions)/.test(r.url()) ||
        r.url().includes("stripe.com") ||
        r.url().includes("ivoracharge"))
    )
      externalWrites.push(r.url());
  });
  await page.goto("/c/demo");
  const charge = page.getByRole("button", { name: "Try a demo charge" });
  await expect(charge).toBeDisabled();
  await page.getByRole("slider").fill("30");
  await expect(page.getByText("$10.50", { exact: false })).toBeVisible();
  await page.getByRole("checkbox").check();
  await charge.click();
  await expect(page).toHaveURL(/\/session\/demo/);
  await expect(
    page.getByRole("heading", { name: "Your car is recharging. You can too." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish charging" }).click();
  await expect(
    page.getByRole("heading", { name: "Ready for your next adventure." }),
  ).toBeVisible();
  await expect(
    page.getByText("Demo receipt. No payment was made."),
  ).toBeVisible();
  expect(externalWrites).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("session controls wait for their JavaScript before accepting a stop", async ({
  page,
}) => {
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route("**/_next/**/*.js", async (route) => {
    await scriptsReady;
    await route.continue();
  });
  const finish = page.getByRole("button", { name: "Finish charging" });
  try {
    await page.goto("/session/demo", { waitUntil: "commit" });
    await expect(finish).toBeVisible();
    await expect(finish).toBeDisabled();
  } finally {
    releaseScripts();
  }
  await expect(finish).toBeEnabled();
  await finish.click();
  await expect(
    page.getByRole("heading", { name: "Ready for your next adventure." }),
  ).toBeVisible();
});
test("host generates a downloadable QR sticker with a real guest URL", async ({
  page,
}) => {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "QR sticker", exact: true })
    .first()
    .click();
  const image = page.getByRole("img", {
    name: "Printable Squid QR sticker for The Weekender",
  });
  await expect(image).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Guest charging link" }),
  ).toHaveValue(`${origin}/c/demo`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).click();
  expect((await download).suggestedFilename()).toBe(
    "squid-the-weekender-sticker.svg",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
test("charger onboarding waits for JavaScript before accepting a click", async ({
  page,
}) => {
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route("**/_next/**/*.js", async (route) => {
    await scriptsReady;
    await route.continue();
  });
  const add = page
    .getByRole("button", { name: "Add a charger", exact: true })
    .first();
  try {
    await page.goto("/demo?onboarding=1", { waitUntil: "commit" });
    await expect(add).toBeVisible();
    await expect(add).toBeDisabled();
  } finally {
    releaseScripts();
  }
  await expect(add).toBeEnabled();
  await add.click();
  await expect(
    page.getByRole("heading", { name: "Tell us about your place." }),
  ).toBeVisible();
});
test("host can add a demo charger and filter it", async ({
  page,
  isMobile,
}) => {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Add a charger", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Property name", { exact: true })
    .fill("Bluebird Cabin");
  await page
    .getByRole("combobox", { name: "Property address" })
    .fill("12 Forest");
  await page
    .getByRole("option", { name: "12 Forest Lane, Asheville, NC" })
    .click();
  await expect(page.getByLabel("Latitude")).toHaveCount(0);
  await expect(page.getByLabel("Longitude")).toHaveCount(0);
  await expect(page.getByLabel("Time zone")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByLabel("Station identity", { exact: true }),
  ).toHaveValue(/^bluebird-cabin-[a-f0-9]{6}$/);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add charger", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bluebird Cabin" }),
  ).toBeVisible();
  await page
    .locator(isMobile ? ".mobile-nav" : ".sidebar")
    .getByRole("button", { name: isMobile ? "Chargers" : /^My chargers/ })
    .click();
  await page.getByRole("textbox", { name: "Search chargers" }).fill("Bluebird");
  await expect(
    page.getByRole("heading", { name: "Bluebird Cabin" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The Weekender", exact: true }),
  ).not.toBeVisible();
});
test("new hosts get a payout step and editing an address clears its selection", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") writes.push(r.url());
  });
  await page.goto("/demo?onboarding=1");
  await page
    .getByRole("button", { name: "Add a charger", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Property name", { exact: true })
    .fill("Bluebird Cabin");
  const address = page.getByRole("combobox", { name: "Property address" });
  await address.fill("12 Forest");
  await page
    .getByRole("option", { name: "12 Forest Lane, Asheville, NC" })
    .click();
  await address.fill("18 Ocean");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("option", { name: "18 Ocean Avenue, San Diego, CA" })
    .waitFor();
  await address.press("ArrowDown");
  await address.press("Enter");
  await expect(address).toHaveValue("18 Ocean Avenue, San Diego, CA");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A home for your earnings." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Finish demo setup", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bluebird Cabin" }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});
test("public requests cannot control host chargers or private guest sessions", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/host/connect", { headers: { origin }, data: {} })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/host/connect", {
        headers: { origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get("/api/sessions/00000000-0000-4000-8000-000000000000")
    ).status(),
  ).toBe(403);
  expect((await request.get("/api/cron/reconcile")).status()).toBe(401);
  expect(
    (
      await request.post("/api/stripe/webhook", {
        data: { type: "checkout.session.completed" },
      })
    ).status(),
  ).toBe(400);
});
test("clicking a charger card opens its own dashboard with a QR download prompt", async ({
  page,
}) => {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "The Weekender", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/charger=/);
  await expect(
    page.getByRole("heading", { name: "The Weekender", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ready for guests" }),
  ).toBeVisible();
  await expect(
    page.getByText("Download and print the QR code for your charger", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Download & print QR code" }).click();
  await expect(
    page.getByRole("img", {
      name: "Printable Squid QR sticker for The Weekender",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "All chargers" }).click();
  await expect(page).not.toHaveURL(/charger=/);
  await expect(
    page.getByRole("heading", { name: "Your place. Good energy." }),
  ).toBeVisible();
});

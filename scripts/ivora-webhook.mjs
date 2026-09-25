import { randomUUID } from "node:crypto";
const [command = "register", argument] = process.argv.slice(2);
const base = (
  process.env.IVORA_API_URL || "https://api.ivoracharge.co"
).replace(/\/$/, "");
const tenant = process.env.IVORA_TENANT_ID;
const key = process.env.IVORA_API_KEY;
if (!tenant || !key) {
  console.error("Set IVORA_API_KEY and IVORA_TENANT_ID in .env first.");
  process.exit(1);
}
const EVENTS = [
  "charging_session.status_changed",
  "bill.finalized",
  "operation.completed",
];
async function call(path, init = {}) {
  const response = await fetch(`${base}/v1/tenants/${tenant}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(
      `Ivora ${response.status}: ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`.trim(),
    );
    process.exit(1);
  }
  return body;
}
const rows = (list) => (Array.isArray(list) ? list : (list?.data ?? []));
if (command === "register") {
  const url =
    argument ||
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/ivora/webhook`
      : "");
  if (!/^https:\/\/[^/]+\/api\/ivora\/webhook$/.test(url)) {
    console.error(
      "Ivora only delivers to public HTTPS endpoints. Pass the deployed URL, for example:\n  npm run ivora:webhook -- register https://squid.example/api/ivora/webhook",
    );
    process.exit(1);
  }
  const hook = await call("/webhooks", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({
      url,
      events: EVENTS,
      description: "Squid session reconciliation",
    }),
  });
  console.log(`Registered webhook ${hook.id} for ${hook.url}.`);
  console.log(
    `\nAdd this to the deployment's environment. Ivora shows it only once:\n\nIVORA_WEBHOOK_SECRET=${hook.secret}\n`,
  );
  console.log(
    `After deploying, verify signature handling with:\n  npm run ivora:webhook -- test ${hook.id}\n  npm run ivora:webhook -- deliveries ${hook.id}`,
  );
} else if (command === "list") {
  for (const hook of rows(await call("/webhooks")))
    console.log(hook.id, hook.status, hook.url, (hook.events || []).join(","));
} else if (command === "test" && argument) {
  console.log(
    JSON.stringify(
      await call(`/webhooks/${argument}/test`, { method: "POST" }),
    ),
  );
} else if (command === "deliveries" && argument) {
  for (const d of rows(await call(`/webhooks/${argument}/deliveries?limit=20`)))
    console.log(
      d.created_at,
      d.event_type,
      d.status,
      `attempts=${d.attempts}`,
      d.last_status ?? "",
      d.last_error ?? "",
    );
} else if (command === "disable" && argument) {
  await call(`/webhooks/${argument}`, { method: "DELETE" });
  console.log(`Disabled ${argument}.`);
} else {
  console.error(
    "Usage: npm run ivora:webhook -- register <https url> | list | test <id> | deliveries <id> | disable <id>",
  );
  process.exit(1);
}

import { describe, expect, it, vi } from "vitest";
import { parseAdminEmails, seedAdmins } from "../scripts/set-admins.mjs";

describe("set-admins script", () => {
  it("trims, lower-cases, de-duplicates and skips blanks", () => {
    expect(
      parseAdminEmails(" A@Example.com, b@example.com ,,a@example.com"),
    ).toEqual(["a@example.com", "b@example.com"]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });

  function fakeClient() {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    const create = vi.fn().mockReturnValue({ from });
    return { create, from, upsert };
  }

  it("uses SUPABASE_URL and upserts the admin emails", async () => {
    const { create, from, upsert } = fakeClient();
    const count = await seedAdmins(
      {
        SUPABASE_URL: "https://project.example.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        ADMIN_EMAILS: "A@example.com",
      },
      create,
    );
    expect(count).toBe(1);
    expect(create.mock.calls[0][0]).toBe("https://project.example.test");
    expect(from).toHaveBeenCalledWith("squid_admins");
    expect(upsert.mock.calls[0][0]).toEqual([{ email: "a@example.com" }]);
  });

  it("falls back to NEXT_PUBLIC_SUPABASE_URL", async () => {
    const { create } = fakeClient();
    await seedAdmins(
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://public.example.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        ADMIN_EMAILS: "a@example.com",
      },
      create,
    );
    expect(create.mock.calls[0][0]).toBe("https://public.example.test");
  });

  it("names the documented variables when config is missing", async () => {
    const { create } = fakeClient();
    await expect(
      seedAdmins({ ADMIN_EMAILS: "a@example.com" }, create),
    ).rejects.toThrow(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.",
    );
    expect(create).not.toHaveBeenCalled();
  });
});

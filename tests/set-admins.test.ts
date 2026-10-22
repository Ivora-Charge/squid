import { describe, expect, it } from "vitest";
import { parseAdminEmails } from "../scripts/set-admins.mjs";

describe("set-admins script", () => {
  it("trims, lower-cases, de-duplicates and skips blanks", () => {
    expect(
      parseAdminEmails(" A@Example.com, b@example.com ,,a@example.com"),
    ).toEqual(["a@example.com", "b@example.com"]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });
});

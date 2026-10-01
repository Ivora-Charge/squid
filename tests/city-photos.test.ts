import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const id = "20000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  property: null as null | {
    id: string;
    city: string;
    state: string;
    host_id: string;
    published: boolean;
  },
  user: vi.fn(),
  saved: new Map<string, unknown>(),
}));
vi.mock("@/lib/server/db", () => ({
  user: mocks.user,
  db: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mocks.property, error: null }),
        }),
      }),
    }),
  }),
  checked: (r: { data: unknown }) => r.data,
  withLock: async (_key: string, run: () => Promise<unknown>) => run(),
  LockBusyError: class extends Error {},
}));
vi.mock("@/lib/server/ivora", () => ({
  durable: async (
    key: string,
    _input: unknown,
    run: () => Promise<unknown>,
  ) => {
    if (mocks.saved.has(key)) return mocks.saved.get(key);
    const result = await run();
    mocks.saved.set(key, result);
    return result;
  },
}));
import { findCityPhotos, propertyCityPhoto } from "@/lib/server/city-photos";
import { GET } from "@/app/api/properties/[id]/photo/route";

function file(name: string, overrides = {}) {
  return {
    title: `File:${name}.jpg`,
    imageinfo: [
      {
        width: 2000,
        height: 1200,
        mime: "image/jpeg",
        url: `https://upload.wikimedia.org/wikipedia/commons/${name}.jpg`,
        thumburl: `https://thumb.wikimedia.org/wikipedia/commons/${name}.jpg?utm_source=wiki`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
        extmetadata: {
          Artist: {
            value: '<a href="https://example.com">Alice &amp; Bob</a>',
          },
          LicenseShortName: { value: "CC BY-SA 4.0" },
          LicenseUrl: {
            value: "https://creativecommons.org/licenses/by-sa/4.0/",
          },
        },
        ...overrides,
      },
    ],
  };
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.saved.clear();
  mocks.property = null;
  mocks.user.mockResolvedValue(null);
  fetchMock = vi.fn(async () =>
    Response.json({
      query: { pages: [file("Fullerton downtown"), file("Fullerton skyline")] },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function request(query = "") {
  return new NextRequest(
    `https://squid.example/api/properties/${id}/photo${query}`,
  );
}
function route(query = "") {
  return GET(request(query), { params: Promise.resolve({ id }) });
}

it("uses the correct state and excludes maps, disasters, historical images and other cities", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({
      query: {
        pages: [
          file("Fullerton downtown"),
          file("Fullerton flag"),
          file("Fullerton flood"),
          file("Fullerton 1910"),
          file("AnotherCity downtown"),
          file("Fullerton map", { mime: "image/svg+xml" }),
        ],
      },
    }),
  );
  await findCityPhotos("Fullerton", "CA");
  expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("titles")).toBe(
    "Fullerton, California",
  );
  expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("titles")).toBe(
    "File:Fullerton downtown.jpg",
  );
});
it("keeps usable credits, strips HTML and tracking parameters, and rejects unlicensed or unsafe images", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ query: { pages: [file("Fullerton downtown")] } }),
  );
  fetchMock.mockResolvedValueOnce(
    Response.json({
      query: {
        pages: [
          file("Fullerton downtown"),
          file("Fullerton restricted", {
            extmetadata: { LicenseShortName: { value: "Fair use" } },
          }),
          file("Fullerton unsafe", {
            thumburl: "https://example.com/not-a-city.jpg",
          }),
          file("Fullerton missing credits", {
            extmetadata: { LicenseShortName: { value: "CC BY 4.0" } },
          }),
        ],
      },
    }),
  );
  const photos = await findCityPhotos("Fullerton", "CA");
  expect(photos).toHaveLength(1);
  expect(photos[0].author).toBe("Alice & Bob");
  expect(photos[0].url).not.toContain("?");
  expect(photos[0].licenseUrl).toBe(
    "https://creativecommons.org/licenses/by-sa/4.0/",
  );
});
it("keeps the saved random choice across later requests without consulting the photo source again", async () => {
  const property = { id, city: "Fullerton", state: "CA" };
  const photo = await propertyCityPhoto(property);
  fetchMock.mockRejectedValue(new Error("Source unavailable"));
  expect(await propertyCityPhoto(property)).toEqual(photo);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("does not disclose an unpublished charger's photo to another user", async () => {
  mocks.property = {
    id,
    city: "Fullerton",
    state: "CA",
    host_id: "owner",
    published: false,
  };
  mocks.user.mockResolvedValue({ id: "other" });
  expect((await route()).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("allows the owner to load an unpublished charger's photo", async () => {
  mocks.property = {
    id,
    city: "Fullerton",
    state: "CA",
    host_id: "owner",
    published: false,
  };
  mocks.user.mockResolvedValue({ id: "owner" });
  expect((await route()).status).toBe(200);
});
it("serves guests a published charger's photo without exposing host or address information", async () => {
  mocks.property = {
    id,
    city: "Fullerton",
    state: "CA",
    host_id: "owner",
    published: true,
  };
  const response = await route();
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(Object.keys(data)).toEqual(["photo"]);
  expect(data.photo.author).toBe("Alice & Bob");
  expect(mocks.user).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
});
it("returns an empty photo when the city has no suitable pictures", async () => {
  mocks.property = {
    id,
    city: "Fullerton",
    state: "CA",
    host_id: "owner",
    published: true,
  };
  fetchMock.mockResolvedValue(Response.json({ query: { pages: [] } }));
  expect(await (await route()).json()).toEqual({ photo: null });
});
it("limits the public demo endpoint to its built-in locations", async () => {
  expect((await route("?demo=1&city=Fullerton&state=CA")).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects unsupported states and extra wiki titles without contacting the provider", async () => {
  expect(await findCityPhotos("Fullerton|AnotherCity", "CA")).toEqual([]);
  expect(await findCityPhotos("Fullerton", "XX")).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

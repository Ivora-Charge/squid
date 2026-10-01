import "server-only";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import type { CityPhoto } from "../types";
import { withLock } from "./db";
import { durable } from "./ivora";

const states: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

const imageInfo = z.object({
  url: z.string(),
  thumburl: z.string().optional(),
  descriptionurl: z.string(),
  width: z.number(),
  height: z.number(),
  mime: z.string(),
  extmetadata: z.record(z.string(), z.object({ value: z.string() })).optional(),
});
const wikiResponse = z.object({
  query: z
    .object({
      pages: z
        .array(
          z.object({
            title: z.string(),
            imageinfo: z.array(imageInfo).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  error: z.unknown().optional(),
});

function plainText(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
      const code = n.startsWith("x") ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(
      /&(?:amp|quot|apos|lt|gt|nbsp);/g,
      (entity) =>
        ({
          "&amp;": "&",
          "&quot;": '"',
          "&apos;": "'",
          "&lt;": "<",
          "&gt;": ">",
          "&nbsp;": " ",
        })[entity] ?? "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
function words(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function trustedUrl(value: string, hosts: string[]) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !hosts.includes(url.hostname)
    )
      return null;
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}
async function wiki(params: Record<string, string>, commons = false) {
  const url = new URL(
    `https://${commons ? "commons.wikimedia.org" : "en.wikipedia.org"}/w/api.php`,
  );
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    ...params,
  }).toString();
  const response = await fetch(url, {
    headers: { "User-Agent": "Squid/1.0 (https://www.squidcharge.io)" },
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("City photo source unavailable");
  const data = wikiResponse.parse(await response.json());
  if (data.error) throw new Error("City photo source unavailable");
  return data.query?.pages ?? [];
}

// Use photographs embedded in the city's own article, rather than a general
// image search that can mix up places with the same name or show unrelated art.
export async function findCityPhotos(
  city: string,
  state: string,
): Promise<CityPhoto[]> {
  const stateName = states[state.toUpperCase()];
  if (
    !stateName ||
    !city.trim() ||
    city.length > 120 ||
    /[|[\]{}#<>]/.test(city)
  )
    return [];
  const images = await wiki({
    titles: `${city.trim()}, ${stateName}`,
    redirects: "1",
    generator: "images",
    gimlimit: "50",
    prop: "imageinfo",
    iiprop: "url|size|mime",
  });
  const names = images
    .filter((p) => {
      const info = p.imageinfo?.[0];
      const title = words(p.title);
      return (
        info?.mime === "image/jpeg" &&
        info.width >= 800 &&
        info.width >= info.height &&
        info.width <= info.height * 3 &&
        title.includes(words(city)) &&
        !/\b(flag|seal|logo|map|portrait|drawing|flood|hurricane|devastation|disaster|fire|paramedic|ambulance|helicopter|bus|police|satellite)\b/.test(
          title,
        ) &&
        !/\b(18\d{2}|19[0-4]\d)\b/.test(title) &&
        Boolean(trustedUrl(info.descriptionurl, ["commons.wikimedia.org"]))
      );
    })
    .slice(0, 8)
    .map((p) => p.title);
  if (!names.length) return [];
  const details = await wiki(
    {
      titles: names.join("|"),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "1280",
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
    },
    true,
  );
  return details
    .flatMap((p) => {
      const info = p.imageinfo?.[0];
      if (!info) return [];
      const license = plainText(
        info.extmetadata?.LicenseShortName?.value ?? "",
      );
      if (
        !/^(CC BY(?:-SA)? [1-4]\.0|CC BY 2\.5|CC0|Public domain|PD)$/.test(
          license,
        )
      )
        return [];
      const url = trustedUrl(info.thumburl ?? info.url, [
        "upload.wikimedia.org",
        "thumb.wikimedia.org",
      ]);
      const sourceUrl = trustedUrl(info.descriptionurl, [
        "commons.wikimedia.org",
      ]);
      const licenseUrl = trustedUrl(info.extmetadata?.LicenseUrl?.value ?? "", [
        "creativecommons.org",
      ]);
      const author = plainText(info.extmetadata?.Artist?.value ?? "");
      if (
        !url ||
        !sourceUrl ||
        (license.startsWith("CC BY") && (!author || !licenseUrl))
      )
        return [];
      return [
        {
          url,
          sourceUrl,
          author: author || "Wikimedia Commons",
          license,
          licenseUrl: licenseUrl ?? sourceUrl,
        },
      ];
    })
    .sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));
}

export class NoCityPhotoError extends Error {}
export async function propertyCityPhoto(p: {
  id: string;
  city: string;
  state: string;
}) {
  const location = { city: p.city, state: p.state };
  const version = createHash("sha256")
    .update(JSON.stringify(location))
    .digest("hex")
    .slice(0, 16);
  // The existing operations store keeps the randomly selected photo across
  // refreshes, devices and deployments. Concurrent visits share one selection.
  return withLock(`city-photo:${p.id}`, () =>
    durable<CityPhoto>(
      `squid:city-photo:${p.id}:${version}:v1`,
      location,
      async () => {
        const photos = await findCityPhotos(p.city, p.state);
        if (!photos.length) throw new NoCityPhotoError();
        return photos[randomInt(photos.length)];
      },
    ),
  );
}
export async function demoCityPhoto(id: string, city: string, state: string) {
  const photos = await findCityPhotos(city, state);
  if (!photos.length) return null;
  return photos[
    createHash("sha256").update(id).digest().readUInt32BE(0) % photos.length
  ];
}

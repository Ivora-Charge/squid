"use client";
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import type { CityPhoto as Photo, Property } from "@/lib/types";

const cache = new Map<string, Photo>();
function savedPhoto(value: unknown): value is Photo {
  if (!value || typeof value !== "object") return false;
  const photo = value as Photo;
  return (
    typeof photo.url === "string" &&
    /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(photo.url) &&
    typeof photo.sourceUrl === "string" &&
    photo.sourceUrl.startsWith("https://commons.wikimedia.org/wiki/") &&
    typeof photo.licenseUrl === "string" &&
    /^(https:\/\/creativecommons\.org\/|https:\/\/commons\.wikimedia\.org\/wiki\/)/.test(
      photo.licenseUrl,
    ) &&
    typeof photo.author === "string" &&
    typeof photo.license === "string"
  );
}
export function CityPhoto({
  property: p,
  demo = false,
}: {
  property: Pick<Property, "id" | "city" | "state">;
  demo?: boolean;
}) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [failed, setFailed] = useState(false);
  const key = `${demo ? "demo:" : ""}${p.id}:${p.city}:${p.state}`;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setPhoto(null);
    setFailed(false);
    async function load() {
      if (cache.has(key)) {
        setPhoto(cache.get(key)!);
        return;
      }
      // Demo chargers live in this browser, so keep their choice here too.
      if (demo) {
        try {
          const saved = localStorage.getItem(`squid-city-photo:${key}`);
          if (saved) {
            const parsed: unknown = JSON.parse(saved);
            if (savedPhoto(parsed)) {
              cache.set(key, parsed);
              setPhoto(parsed);
              return;
            }
          }
        } catch {
          /* Storage is optional in private browsing. */
        }
      }
      const params = demo
        ? `?${new URLSearchParams({ demo: "1", city: p.city, state: p.state })}`
        : "";
      for (let attempt = 0; attempt < 12 && active; attempt++) {
        const response = await fetch(
          `/api/properties/${encodeURIComponent(p.id)}/photo${params}`,
          { signal: controller.signal },
        );
        if (response.status === 202) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        if (!response.ok) return;
        const { photo: selected } = (await response.json()) as {
          photo: Photo | null;
        };
        if (!active || !selected) return;
        cache.set(key, selected);
        setPhoto(selected);
        if (demo) {
          try {
            localStorage.setItem(
              `squid-city-photo:${key}`,
              JSON.stringify(selected),
            );
          } catch {
            /* Optional cache. */
          }
        }
        return;
      }
    }
    void load().catch(() => {
      /* Keep the location placeholder if the source is unavailable. */
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, p.id, p.city, p.state, demo]);
  return (
    <>
      {photo && !failed ? (
        <img
          src={photo.url}
          alt={`A view of ${p.city}, ${p.state}`}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="city-photo-placeholder" aria-hidden="true">
          <MapPin size={44} strokeWidth={1} />
        </div>
      )}
      {photo && !failed && (
        <span
          className="city-photo-credit"
          onClick={(event) => event.stopPropagation()}
        >
          <a
            href={photo.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={`Photo by ${photo.author}`}
          >
            Photo: {photo.author}
          </a>
          <a href={photo.licenseUrl} target="_blank" rel="noreferrer">
            {photo.license}
          </a>
        </span>
      )}
    </>
  );
}

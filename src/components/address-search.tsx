"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, MapPin } from "lucide-react";
import { browserId } from "@/lib/browser-id";
import {
  demoAddresses,
  type AddressSelection,
  type AddressSuggestion,
} from "@/lib/onboarding";
import { ErrorMessage } from "./ui";

export function AddressSearch({
  demo,
  selection,
  onSelect,
}: {
  demo: boolean;
  selection: AddressSelection | null;
  onSelect: (address: AddressSelection | null) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState(selection?.label || "");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [session, setSession] = useState(browserId);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    if (selection || query.trim().length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setError("");
      try {
        let matches: AddressSuggestion[];
        if (demo) {
          matches = demoAddresses.filter((a) =>
            a.label.toLowerCase().includes(query.trim().toLowerCase()),
          );
        } else {
          const response = await fetch("/api/host/address", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "suggest", query, session }),
            signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error || "Address search is unavailable.");
          matches = data.suggestions;
        }
        if (!controller.signal.aborted) {
          setSuggestions(matches);
          setActive(matches.length ? 0 : -1);
          setOpen(true);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, selection, session, demo]);
  async function choose(suggestion: AddressSuggestion) {
    const version = ++generation.current;
    setOpen(false);
    setBusy(true);
    setError("");
    try {
      let address: AddressSelection;
      if (demo) address = { label: suggestion.label, token: suggestion.id };
      else {
        const response = await fetch("/api/host/address", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "select",
            placeId: suggestion.id,
            session,
          }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Please select your address again.");
        address = data.address;
      }
      if (version === generation.current) {
        onSelect(address);
        setQuery(address.label);
        setSession(browserId());
        setSuggestions([]);
      }
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  return (
    <div className="address-search">
      <label htmlFor={`${listId}-input`}>Property address</label>
      <input
        id={`${listId}-input`}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open && suggestions.length > 0}
        aria-activedescendant={
          open && active >= 0 ? `${listId}-${active}` : undefined
        }
        aria-describedby={`${listId}-hint`}
        autoComplete="off"
        placeholder="Start typing your street address"
        maxLength={200}
        value={query}
        onChange={(e) => {
          generation.current++;
          setQuery(e.target.value);
          onSelect(null);
          setSuggestions([]);
          setActive(-1);
          setOpen(false);
          setBusy(false);
          setError("");
        }}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (
            (e.key === "ArrowDown" || e.key === "ArrowUp") &&
            suggestions.length
          ) {
            e.preventDefault();
            setOpen(true);
            setActive(
              (n) =>
                (n + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
                suggestions.length,
            );
          }
          if (e.key === "Enter" && !selection) {
            e.preventDefault();
            if (open && active >= 0) void choose(suggestions[active]);
          }
        }}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Address suggestions"
          className="address-suggestions"
        >
          {suggestions.map((s, i) => (
            <li key={s.id} role="presentation">
              <button
                type="button"
                role="option"
                id={`${listId}-${i}`}
                aria-selected={active === i}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void choose(s)}
              >
                <MapPin size={16} />
                <span>{s.label}</span>
              </button>
            </li>
          ))}
          {!demo && (
            <li role="presentation" className="maps-attribution" translate="no">
              Google Maps
            </li>
          )}
        </ul>
      )}
      <p id={`${listId}-hint`} className="fine-print" role="status">
        {busy ? (
          "Finding your address…"
        ) : selection ? (
          <>
            <Check size={13} /> Address selected
          </>
        ) : demo ? (
          "Try a sample address: 12 Forest Lane or 18 Ocean Avenue."
        ) : open && !suggestions.length ? (
          "No matches yet. Add your city or ZIP code."
        ) : (
          "Choose a suggestion to fill in your property’s location."
        )}
      </p>
      {!demo && selection && (
        <span className="maps-attribution" translate="no">
          Google Maps
        </span>
      )}
      <ErrorMessage message={error} />
    </div>
  );
}

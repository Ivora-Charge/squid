"use client";
import { useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { compatibleChargers } from "./chargers";

export function ChargerTable() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = compatibleChargers
    .map(({ brand, models }) => ({
      brand,
      models: brand.toLowerCase().includes(q)
        ? models
        : models.filter(({ model }) => model.toLowerCase().includes(q)),
    }))
    .filter(({ models }) => models.length > 0);
  const shown = filtered.reduce((n, { models }) => n + models.length, 0);
  const total = compatibleChargers.reduce(
    (n, { models }) => n + models.length,
    0,
  );
  return (
    <>
      <div className="table-tools">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search compatible chargers"
            placeholder="Search brand or model…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <small>
          {shown} of {total} models
        </small>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>BRAND</th>
              <th>MODEL</th>
              <th>SETUP GUIDE</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ brand, models }) =>
              models.map(({ model, guideUrl }, i) => (
                <tr key={`${brand}-${model}`}>
                  {i === 0 && (
                    <td rowSpan={models.length}>
                      <strong>{brand}</strong>
                    </td>
                  )}
                  <td>{model}</td>
                  <td>
                    <a href={guideUrl} target="_blank" rel="noreferrer">
                      Manufacturer guide <ArrowUpRight size={12} />
                    </a>
                  </td>
                </tr>
              )),
            )}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3}>
                  No matches — but if your charger’s settings have an OCPP
                  section, it will likely still work.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

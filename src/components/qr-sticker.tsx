"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Check, Download, Printer, ArrowUpRight } from "lucide-react";
import { Modal } from "./ui";
import type { Property } from "@/lib/types";
function escapeXml(value: string) {
  return value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
export function QRSticker({
  property,
  demo,
  onClose,
}: {
  property: Property;
  demo: boolean;
  onClose: () => void;
}) {
  const [svg, setSvg] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    const link = `${window.location.origin}/c/${demo ? "demo" : property.slug}`;
    setUrl(link);
    QRCode.toString(link, {
      type: "svg",
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#141716", light: "#ffffff" },
    }).then((qr) => {
      if (!active) return;
      const inner = qr
        .replace(/<svg /, '<svg x="54" y="200" width="292" height="292" ')
        .replace(
          /width="[^\"]*" height="[^\"]*" viewBox/,
          'width="292" height="292" viewBox',
        );
      setSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" rx="28" fill="#171b18"/><text x="200" y="65" fill="#fa876a" font-family="Arial,sans-serif" font-size="38" font-weight="bold" text-anchor="middle">squid</text><text x="200" y="92" fill="#b3b7ad" font-family="Arial,sans-serif" font-size="11" letter-spacing="3" text-anchor="middle">BY IVORA</text><text x="200" y="145" fill="#f4f2e9" font-family="Arial,sans-serif" font-size="28" font-weight="bold" text-anchor="middle">A little charge.</text><text x="200" y="180" fill="#fa876a" font-family="Arial,sans-serif" font-size="28" font-weight="bold" text-anchor="middle">A better stay.</text>${inner}<text x="200" y="530" fill="#f4f2e9" font-family="Arial,sans-serif" font-size="16" font-weight="bold" text-anchor="middle">SCAN. PLUG IN. UNWIND.</text><text x="200" y="558" fill="#b3b7ad" font-family="Arial,sans-serif" font-size="12" text-anchor="middle">${escapeXml(property.name.slice(0, 40))}</text><text x="200" y="580" fill="#b3b7ad" font-family="Arial,sans-serif" font-size="10" text-anchor="middle">Check the price and pay securely on your phone.</text></svg>`,
      );
    });
    return () => {
      active = false;
    };
  }, [property, demo]);
  const image = svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    : "";
  function download() {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `squid-${property.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-sticker.svg`;
    a.click();
    URL.revokeObjectURL(href);
  }
  return (
    <Modal title="A little sticker. A warm welcome." onClose={onClose}>
      <p className="modal-description">
        Place this by your charger. Guests can scan it with their phone’s
        camera—no app needed.
      </p>
      <div className="sticker-preview">
        {image ? (
          <img
            src={image}
            alt={`Printable Squid QR sticker for ${property.name}`}
          />
        ) : (
          <p>Making your sticker…</p>
        )}
      </div>
      <div className="copy-field">
        <input aria-label="Guest charging link" value={url} readOnly />
        <button
          className="icon-button"
          aria-label="Copy guest link"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      <div className="form-actions">
        <a
          className="button secondary"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          Preview <ArrowUpRight size={16} />
        </a>
        <button
          className="button secondary"
          disabled={!svg}
          onClick={() => window.print()}
        >
          <Printer size={16} /> Print
        </button>
        <button className="button primary" disabled={!svg} onClick={download}>
          <Download size={16} /> Download SVG
        </button>
      </div>
      <p className="fine-print">
        Print at least 3 inches wide. For outdoor chargers, use a weatherproof
        label. {demo ? "This QR opens the demo guest experience." : ""}
      </p>
    </Modal>
  );
}

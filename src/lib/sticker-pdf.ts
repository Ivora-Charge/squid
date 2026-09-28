import QRCode from "qrcode";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  setCharacterSpacing,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

// PDF units are points: 72 per inch.
const INCH = 72;

function hex(value: string): RGB {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const ink = hex("#141716");
const night = hex("#171b18");
const coral = hex("#fa876a");
const cream = hex("#f4f2e9");
const mist = hex("#b3b7ad");
const slate = hex("#5d625b");
const white = rgb(1, 1, 1);

type Fonts = { regular: PDFFont; bold: PDFFont };

// Standard PDF fonts only cover WinAnsi, so drop anything they can't encode
// (emoji, CJK) rather than failing the whole download.
function encodable(font: PDFFont, text: string) {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text)
    .filter((c) => /\s/.test(c) || supported.has(c.codePointAt(0)!))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function centered(
  page: PDFPage,
  text: string,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB,
  spacing = 0,
) {
  const clean = encodable(font, text);
  const width =
    font.widthOfTextAtSize(clean, size) +
    spacing * Math.max(clean.length - 1, 0);
  if (spacing) page.pushOperators(setCharacterSpacing(spacing));
  page.drawText(clean, {
    x: (page.getWidth() - width) / 2,
    y,
    font,
    size,
    color,
  });
  if (spacing) page.pushOperators(setCharacterSpacing(0));
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of encodable(font, text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function clamp(lines: string[], max: number) {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/[\s.,;:]*$/, "")}…`;
  return kept;
}

// Draws the QR as vector modules on a white square, keeping a two-module
// quiet zone so phone cameras can lock on.
function drawQr(
  page: PDFPage,
  link: string,
  x: number,
  y: number,
  size: number,
) {
  const { modules } = QRCode.create(link, { errorCorrectionLevel: "M" });
  const count = modules.size + 4;
  const cell = size / count;
  page.drawRectangle({ x, y, width: size, height: size, color: white });
  for (let row = 0; row < modules.size; row++) {
    let col = 0;
    while (col < modules.size) {
      if (!modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < modules.size && modules.get(row, col)) col++;
      page.drawRectangle({
        x: x + (start + 2) * cell,
        y: y + size - (row + 3) * cell,
        width: (col - start) * cell,
        // A hair of overlap hides seams between rows in some viewers.
        height: cell + 0.05,
        color: ink,
      });
    }
  }
}

const STICKER = { width: 3 * INCH, height: 4.5 * INCH };
// Artwork runs past the cut line so a slightly-off cut shows no white edge.
const BLEED = 0.0625 * INCH;

function drawSticker(page: PDFPage, fonts: Fonts, link: string, name: string) {
  // Same artwork as the on-screen preview, scaled to 3 × 4.5 in and centered
  // on the sheet. Text centers on the page, which is also the sticker center.
  const left = (page.getWidth() - STICKER.width) / 2;
  const bottom = (page.getHeight() - STICKER.height) / 2;
  const top = bottom + STICKER.height;
  const s = STICKER.width / 400;
  const y = (svgY: number) => top - svgY * s;
  page.drawRectangle({
    x: left - BLEED,
    y: bottom - BLEED,
    width: STICKER.width + BLEED * 2,
    height: STICKER.height + BLEED * 2,
    color: night,
  });
  centered(page, "squid", y(65), fonts.bold, 38 * s, coral);
  centered(page, "BY IVORA", y(92), fonts.regular, 11 * s, mist, 3 * s);
  centered(page, "A little charge.", y(145), fonts.bold, 28 * s, cream);
  centered(page, "A better stay.", y(180), fonts.bold, 28 * s, coral);
  drawQr(page, link, left + 54 * s, y(200 + 292), 292 * s);
  centered(page, "SCAN. PLUG IN. UNWIND.", y(530), fonts.bold, 16 * s, cream);
  centered(page, name.slice(0, 40), y(558), fonts.regular, 12 * s, mist);
  centered(
    page,
    "Check the price and pay securely on your phone.",
    y(580),
    fonts.regular,
    10 * s,
    mist,
  );
  page.drawRectangle({
    x: left,
    y: bottom,
    width: STICKER.width,
    height: STICKER.height,
    borderColor: mist,
    borderWidth: 0.75,
    borderDashArray: [5, 4],
  });
  centered(
    page,
    "Cut along the dashed line.",
    bottom - BLEED - 22,
    fonts.regular,
    10,
    slate,
  );
}

const steps = [
  {
    title: "Scan the code",
    body: "Point your phone’s camera at the code. No app or signup needed.",
  },
  {
    title: "Plug in",
    body: "Connect the charger to your vehicle and check the connector is seated.",
  },
  {
    title: "Pay and unwind",
    body: "Check the price and pay by card. You only pay for the energy you use.",
  },
];

function drawInstructions(
  page: PDFPage,
  fonts: Fonts,
  link: string,
  name: string,
  instructions: string,
) {
  const width = page.getWidth();
  const margin = 0.75 * INCH;
  page.drawRectangle({
    x: 0,
    y: page.getHeight() - 14,
    width,
    height: 14,
    color: coral,
  });

  let y = page.getHeight() - 66;
  centered(page, "squid", y, fonts.bold, 40, coral);
  y -= 20;
  centered(page, "BY IVORA", y, fonts.regular, 10, slate, 3);
  y -= 50;
  centered(page, "Charge your EV here.", y, fonts.bold, 36, ink);
  y -= 30;
  centered(page, "A little charge. A better stay.", y, fonts.bold, 18, coral);
  y -= 26;
  const title = clamp(wrap(fonts.regular, name, 14, width - margin * 2), 2);
  const note = clamp(
    wrap(fonts.regular, instructions, 10.5, width - margin * 2 - 32),
    3,
  );
  for (const line of title) {
    centered(page, line, y, fonts.regular, 14, slate);
    y -= 18;
  }

  // Long names and host notes borrow their space from the QR.
  const qr =
    3.75 * INCH - (title.length - 1) * 18 - Math.max(note.length - 2, 0) * 15;
  const frame = 10;
  y -= 10 + frame + qr;
  page.drawRectangle({
    x: (width - qr) / 2 - frame,
    y: y - frame,
    width: qr + frame * 2,
    height: qr + frame * 2,
    borderColor: ink,
    borderWidth: 3,
  });
  drawQr(page, link, (width - qr) / 2, y, qr);
  y -= frame + 26;
  centered(page, "SCAN WITH YOUR PHONE’S CAMERA", y, fonts.bold, 11, ink, 1.5);

  y -= 40;
  const gap = 24;
  const column = (width - margin * 2 - gap * 2) / 3;
  let lowest = y;
  steps.forEach((step, i) => {
    const x = margin + i * (column + gap);
    page.drawCircle({ x: x + 13, y: y + 4, size: 13, color: coral });
    const digit = String(i + 1);
    page.drawText(digit, {
      x: x + 13 - fonts.bold.widthOfTextAtSize(digit, 13) / 2,
      y: y - 0.5,
      font: fonts.bold,
      size: 13,
      color: ink,
    });
    page.drawText(step.title, {
      x: x + 34,
      y,
      font: fonts.bold,
      size: 13,
      color: ink,
    });
    let line = y - 24;
    for (const text of wrap(fonts.regular, step.body, 10.5, column)) {
      page.drawText(text, {
        x,
        y: line,
        font: fonts.regular,
        size: 10.5,
        color: slate,
      });
      line -= 15;
    }
    lowest = Math.min(lowest, line);
  });
  y = lowest - 8;

  if (note.length) {
    const height = 38 + note.length * 15;
    page.drawRectangle({
      x: margin,
      y: y - height,
      width: width - margin * 2,
      height,
      color: hex("#f4f2e9"),
    });
    page.drawText("FROM YOUR HOST", {
      x: margin + 16,
      y: y - 22,
      font: fonts.bold,
      size: 9,
      color: slate,
    });
    note.forEach((text, i) =>
      page.drawText(text, {
        x: margin + 16,
        y: y - 40 - i * 15,
        font: fonts.regular,
        size: 10.5,
        color: ink,
      }),
    );
  }
}

export type StickerPdfKind = "instructions" | "sticker";

export async function stickerPdf(
  kind: StickerPdfKind,
  link: string,
  name: string,
  instructions: string,
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    `Squid ${kind === "sticker" ? "sticker" : "charging sign"} · ${name}`,
  );
  pdf.setCreator("Squid by Ivora");
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  // Both print on US Letter.
  const page = pdf.addPage([8.5 * INCH, 11 * INCH]);
  if (kind === "sticker") {
    drawSticker(page, fonts, link, name);
  } else {
    drawInstructions(page, fonts, link, name, instructions);
  }
  return pdf.save();
}

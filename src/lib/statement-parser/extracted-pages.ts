import { z } from "zod";
import type { ExtractedPage, PageKind, PageSignals } from "./page-schema";

export const VISION_PAGE_CAP = 40;
export const SALVAGE_IMAGE_AREA_RATIO = 0.25;
export const FALLBACK_SCANNED_ALNUM_MAX = 80;

export class VisionPageCapError extends Error {
  constructor(count: number) {
    super(
      `VisionPageCapError: ${count} scanned pages exceeds cap of ${VISION_PAGE_CAP}`,
    );
    this.name = "VisionPageCapError";
  }
}

export function assertVisionPageCap(count: number): void {
  if (count > VISION_PAGE_CAP) throw new VisionPageCapError(count);
}

export function fallbackKindFromText(text: string): PageKind {
  const alnum = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  return alnum < FALLBACK_SCANNED_ALNUM_MAX ? "scanned" : "text";
}

const extractedPageInSchema = z.object({
  page: z.number(),
  text: z.string(),
  kind: z.enum(["text", "scanned", "blank"]).optional(),
  signals: z
    .object({
      char_count: z.number(),
      alnum_count: z.number(),
      word_count: z.number(),
      image_area_ratio: z.number(),
    })
    .optional(),
});

const extractedPagesSchema = z.object({
  pages: z.array(extractedPageInSchema),
});

function defaultSignals(text: string): PageSignals {
  const alnum = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  return {
    char_count: text.length,
    alnum_count: alnum,
    word_count: text.trim() ? text.trim().split(/\s+/).length : 0,
    image_area_ratio: 0,
  };
}

/**
 * Parse sandbox `/extract-pages` JSON. If `kind` is missing (old sandbox
 * during deploy skew), fall back to alphanumeric density of the page text.
 */
export function parseExtractedPages(rawJson: string): ExtractedPage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`pdfplumber output is not JSON: ${(err as Error).message}`);
  }
  const result = extractedPagesSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `pdfplumber output did not match expected shape: ${result.error.message}`,
    );
  }
  return result.data.pages.map((p) => ({
    page: p.page,
    text: p.text,
    kind: p.kind ?? fallbackKindFromText(p.text),
    signals: p.signals ?? defaultSignals(p.text),
  }));
}

export function shouldSalvagePage(
  page: ExtractedPage,
  txCount: number,
): boolean {
  return (
    page.kind === "text" &&
    txCount === 0 &&
    page.signals.image_area_ratio >= SALVAGE_IMAGE_AREA_RATIO
  );
}

export function scannedPageNumbers(pages: ExtractedPage[]): number[] {
  return pages.filter((p) => p.kind === "scanned").map((p) => p.page);
}

export function salvagePageNumbers(
  pages: ExtractedPage[],
  txCountByPage: Map<number, number>,
): number[] {
  return pages
    .filter((p) => shouldSalvagePage(p, txCountByPage.get(p.page) ?? 0))
    .map((p) => p.page);
}

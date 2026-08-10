import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Polyfill DOMMatrix for standard pdf-parse support in Node.js 20+
if (typeof (global as any).DOMMatrix === "undefined") {
  (global as any).DOMMatrix = class DOMMatrix {
    constructor() {}
  };
}

let PDFParse: any = null;
try {
  const mod = require('pdf-parse');
  PDFParse = mod?.PDFParse || mod?.default?.PDFParse || mod?.default || mod;
} catch {
  console.warn('[pdfExtractor] pdf-parse loading deferred.');
}
import { storageReadBytes } from "./storage";

/**
 * If `url` points at this server's own /local-storage/<key> endpoint,
 * pull `<key>` out so the caller can read the bytes directly from disk
 * via storageReadBytes — avoiding the <PUBLIC_BASE_URL> round-trip.
 * Returns null for external URLs (Forge proxy, S3, etc.) which pdf-parse
 * can still fetch directly.
 */
function extractLocalStorageKey(url: string): string | null {
  const marker = "/local-storage/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(url.substring(idx + marker.length));
  } catch {
    return null;
  }
}

export type PdfPageText = {
  pageNumber: number;
  text: string;
};

function normalizePdfPageText(value: string): string {
  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    // Keep column spacing for tables (SOA/SOE) instead of flattening all runs to a single space.
    .replace(/[ ]{12,}/g, "          ")
    .replace(/\n{3,}/g, "\n\n");

  return normalized
    .split("\n")
    .map((line) => line.replace(/[ ]+$/g, ""))
    .join("\n")
    .trim();
}

async function extractPagesFromParser(parser: any): Promise<PdfPageText[]> {
  const info = await parser.getInfo({ parsePageInfo: true });
  const totalPagesRaw =
    (info && typeof info.total === "number" ? info.total : null) ??
    (info && typeof info.numpages === "number" ? info.numpages : null);
  const totalPages = Math.max(1, Number(totalPagesRaw || 1));

  const pages: PdfPageText[] = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const result = await parser.getText({ partial: [pageNumber] });
    pages.push({
      pageNumber,
      text: normalizePdfPageText(String(result?.text || "")),
    });
  }
  return pages;
}

async function withParser<T>(
  source: { url: string } | { data: Buffer },
  fn: (parser: any) => Promise<T>
): Promise<T> {
  let parser: any;
  try {
    parser = new PDFParse(source);
    return await fn(parser);
  } finally {
    try {
      if (parser?.destroy) await parser.destroy();
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Extract page-level text from a PDF URL.
 * Each page is returned independently so downstream chunking can preserve page references.
 *
 * If the URL points at this server's own /local-storage/<key> route, the
 * bytes are read directly from disk via storageReadBytes instead of being
 * fetched over HTTP. This avoids the PUBLIC_BASE_URL round-trip that
 * breaks in environments where PUBLIC_BASE_URL isn't set to the FE's
 * public hostname (e.g. cloud).
 */
export async function extractPdfPages(pdfUrl: string): Promise<PdfPageText[]> {
  try {
    const localKey = extractLocalStorageKey(pdfUrl);
    if (localKey !== null) {
      console.log(`[pdfExtractor] Reading local-storage key from disk: ${localKey}`);
      const buffer = await storageReadBytes(localKey);
      return await withParser({ data: buffer }, extractPagesFromParser);
    }
    console.log(`[pdfExtractor] Fetching PDF for page-aware parse: ${pdfUrl}`);
    return await withParser({ url: pdfUrl }, extractPagesFromParser);
  } catch (error) {
    console.error("[pdfExtractor] Error extracting PDF pages:", error);
    throw new Error(
      `Failed to extract page-level text from PDF: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Same as extractPdfPages but reads the PDF directly from an in-memory Buffer.
 * Use this when the bytes are already in the process — skips the HTTP
 * round-trip that PUBLIC_BASE_URL would otherwise require.
 */
export async function extractPdfPagesFromBuffer(buffer: Buffer): Promise<PdfPageText[]> {
  try {
    return await withParser({ data: buffer }, extractPagesFromParser);
  } catch (error) {
    console.error("[pdfExtractor] Error extracting PDF pages from buffer:", error);
    throw new Error(
      `Failed to extract page-level text from PDF buffer: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Extract text content from a PDF. Accepts either a public URL (string) or
 * the raw bytes (Buffer). Prefer the Buffer form when the bytes are already
 * in memory.
 */
export async function extractPdfText(input: string | Buffer): Promise<string> {
  try {
    const pages = typeof input === "string"
      ? await extractPdfPages(input)
      : await extractPdfPagesFromBuffer(input);
    return pages
      .map((page) => `Page ${page.pageNumber}\n${page.text}`)
      .join("\n\n");
  } catch (error) {
    console.error("[pdfExtractor] Error extracting PDF text:", error);
    throw new Error(
      `Failed to extract text from PDF: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

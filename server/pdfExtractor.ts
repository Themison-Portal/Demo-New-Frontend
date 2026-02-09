import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

export type PdfPageText = {
  pageNumber: number;
  text: string;
};

function normalizePdfPageText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract page-level text from a PDF URL.
 * Each page is returned independently so downstream chunking can preserve page references.
 */
export async function extractPdfPages(pdfUrl: string): Promise<PdfPageText[]> {
  let parser: any;
  try {
    console.log(`[pdfExtractor] Fetching PDF for page-aware parse: ${pdfUrl}`);
    parser = new PDFParse({ url: pdfUrl });

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
  } catch (error) {
    console.error("[pdfExtractor] Error extracting PDF pages:", error);
    throw new Error(
      `Failed to extract page-level text from PDF: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  } finally {
    try {
      if (parser?.destroy) {
        await parser.destroy();
      }
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Extract text content from a PDF file URL
 * @param pdfUrl - Public URL to the PDF file
 * @returns Extracted text content
 */
export async function extractPdfText(pdfUrl: string): Promise<string> {
  try {
    const pages = await extractPdfPages(pdfUrl);
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

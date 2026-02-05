import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

/**
 * Extract text content from a PDF file URL
 * @param pdfUrl - Public URL to the PDF file
 * @returns Extracted text content
 */
export async function extractPdfText(pdfUrl: string): Promise<string> {
  try {
    console.log(`Attempting to fetch PDF from: ${pdfUrl}`);
    
    // Create parser instance with URL
    const parser = new PDFParse({ url: pdfUrl });
    
    // Extract text from PDF
    const result = await parser.getText();
    
    return result.text;
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

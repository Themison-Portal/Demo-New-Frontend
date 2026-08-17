/**
 * Google File Search Store Management
 * Handles creation, management, and querying of File Search Stores for RAG
 */

import { GoogleGenAI } from '@google/genai';
import { ENV } from './env';

// Initialize Google GenAI client
const client = new GoogleGenAI({ apiKey: ENV.geminiApiKey || "dummy-key" });

/**
 * Create a new File Search Store for a trial
 */
export async function createFileSearchStore(displayName: string): Promise<string> {
  try {
    const store = await client.fileSearchStores.create({
      config: { displayName: displayName },
    });
    
    return store.name!; // Returns something like 'fileSearchStores/abc123'
  } catch (error: any) {
    console.error('Error creating File Search Store:', error);
    throw new Error(`Failed to create File Search Store: ${error.message}`);
  }
}

/**
 * Upload a file directly to a File Search Store
 * @param fileBuffer - The file content as a Buffer
 * @param fileName - Display name for the file
 * @param storeName - The File Search Store name (e.g., 'fileSearchStores/abc123')
 */
export async function uploadToFileSearchStore(
  fileBuffer: Buffer,
  fileName: string,
  storeName: string
): Promise<string> {
  try {
    // Convert Buffer to Blob for the API
    // Create a new Uint8Array from the buffer data
    const uint8Array = Uint8Array.from(fileBuffer);
    const blob = new Blob([uint8Array], { type: 'application/pdf' });
    
    const operation = await client.fileSearchStores.uploadToFileSearchStore({
      file: blob,
      fileSearchStoreName: storeName,
      config: {
        displayName: fileName,
      },
    });

    // Wait for the operation to complete
    let completedOp = operation;
    while (!completedOp.done) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      completedOp = await client.operations.get({ operation: completedOp });
    }

    // The response contains the document information
    // Return a success indicator since we don't need the document name for tracking
    return storeName; // Just return the store name as confirmation
  } catch (error: any) {
    console.error('Error uploading to File Search Store:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

/**
 * Delete a File Search Store
 */
export async function deleteFileSearchStore(storeName: string): Promise<void> {
  try {
    await client.fileSearchStores.delete({
      name: storeName,
      config: { force: true }, // Force delete even if it contains documents
    });
  } catch (error: any) {
    console.error('Error deleting File Search Store:', error);
    throw new Error(`Failed to delete File Search Store: ${error.message}`);
  }
}

/**
 * List all documents in a File Search Store
 */
export async function listDocumentsInStore(storeName: string): Promise<any[]> {
  try {
    const documents = [];
    const pager = await client.fileSearchStores.documents.list({ parent: storeName });
    for await (const doc of pager) {
      documents.push(doc);
    }
    return documents;
  } catch (error: any) {
    console.error('Error listing documents:', error);
    throw new Error(`Failed to list documents: ${error.message}`);
  }
}

/**
 * Delete a specific document from a File Search Store
 */
export async function deleteDocumentFromStore(documentName: string): Promise<void> {
  try {
    await client.fileSearchStores.documents.delete({ name: documentName });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    throw new Error(`Failed to delete document: ${error.message}`);
  }
}

/**
 * Query with File Search (used in chat endpoint)
 * @param query - The user's question
 * @param storeNames - Array of File Search Store names to search
 */
export async function queryWithFileSearch(
  query: string,
  storeNames: string[]
): Promise<{ answer: string; citations?: any[] }> {
  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: query,
      config: {
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: storeNames,
            },
          },
        ],
      },
    });

    const answer = response.text || 'No response generated';
    
    // Extract citations if available
    const citations = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    return {
      answer,
      citations: citations.length > 0 ? citations : undefined,
    };
  } catch (error: any) {
    console.error('Error querying with File Search:', error);
    throw new Error(`Failed to query: ${error.message}`);
  }
}

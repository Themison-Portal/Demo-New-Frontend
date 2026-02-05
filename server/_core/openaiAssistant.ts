/**
 * OpenAI Assistants API with File Search
 * Handles Vector Store creation, file uploads, and RAG queries
 */

import OpenAI from 'openai';
import { ENV } from './env';

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: ENV.openaiApiKey });

/**
 * Create a new Vector Store for a trial
 * @param displayName - Human-readable name for the vector store
 * @returns Vector Store ID (e.g., 'vs_abc123')
 */
export async function createVectorStore(displayName: string): Promise<string> {
  try {
    const vectorStore = await openai.vectorStores.create({
      name: displayName,
    });
    
    return vectorStore.id;
  } catch (error: any) {
    console.error('Error creating Vector Store:', error);
    throw new Error(`Failed to create Vector Store: ${error.message}`);
  }
}

/**
 * Upload a file to a Vector Store
 * @param fileBuffer - The file content as a Buffer
 * @param fileName - Display name for the file
 * @param vectorStoreId - The Vector Store ID (e.g., 'vs_abc123')
 * @returns File ID in the vector store
 */
export async function uploadToVectorStore(
  fileBuffer: Buffer,
  fileName: string,
  vectorStoreId: string
): Promise<string> {
  try {
    // Create a File object from the buffer
    // Convert Buffer to Uint8Array for compatibility
    const uint8Array = new Uint8Array(fileBuffer);
    const file = new File([uint8Array], fileName, { type: 'application/pdf' });
    
    // Upload file to OpenAI
    const uploadedFile = await openai.files.create({
      file: file,
      purpose: 'assistants',
    });

    // Add file to vector store
    await openai.vectorStores.files.create(vectorStoreId, {
      file_id: uploadedFile.id,
    });

    // Wait for file to be processed
    let fileStatus = await openai.vectorStores.files.retrieve(
      uploadedFile.id,
      { vector_store_id: vectorStoreId }
    );

    // Poll until processing is complete
    while (fileStatus.status === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      fileStatus = await openai.vectorStores.files.retrieve(
        uploadedFile.id,
        { vector_store_id: vectorStoreId }
      );
    }

    if (fileStatus.status === 'failed') {
      throw new Error('File processing failed');
    }

    return uploadedFile.id;
  } catch (error: any) {
    console.error('Error uploading to Vector Store:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

/**
 * Create an Assistant with file_search tool enabled
 * @param name - Assistant name
 * @param instructions - System instructions for the assistant
 * @param vectorStoreIds - Array of vector store IDs to search
 * @returns Assistant ID
 */
export async function createAssistant(
  name: string,
  instructions: string,
  vectorStoreIds: string[]
): Promise<string> {
  try {
    const assistant = await openai.beta.assistants.create({
      name,
      instructions,
      model: 'gpt-4o',
      tools: [{ type: 'file_search' }],
      tool_resources: {
        file_search: {
          vector_store_ids: vectorStoreIds,
        },
      },
    });

    return assistant.id;
  } catch (error: any) {
    console.error('Error creating Assistant:', error);
    throw new Error(`Failed to create Assistant: ${error.message}`);
  }
}

/**
 * Query with OpenAI Assistant (RAG)
 * @param query - The user's question
 * @param vectorStoreIds - Array of Vector Store IDs to search
 * @returns Answer and citations
 */
export async function queryWithAssistant(
  query: string,
  vectorStoreIds: string[]
): Promise<{ answer: string; citations?: any[] }> {
  try {
    // Create a temporary assistant for this query
    const assistant = await openai.beta.assistants.create({
      name: 'Themison AI',
      instructions: `You are Themison AI, a helpful assistant for clinical trial research teams. You help with:
- Understanding clinical trial protocols and procedures
- Answering questions about trial operations and regulations
- Providing guidance on study setup and execution
- Assisting with document analysis and organization

Be professional, accurate, and helpful. Use clear clinical terminology when appropriate.
Always cite the specific documents and sections you reference in your answers.`,
      model: 'gpt-4o',
      tools: [{ type: 'file_search' }],
      tool_resources: {
        file_search: {
          vector_store_ids: vectorStoreIds,
        },
      },
    });

    // Create a thread
    const thread = await openai.beta.threads.create();

    // Add the user's message
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: query,
    });

    // Run the assistant
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistant.id,
    });

    if (run.status !== 'completed') {
      throw new Error(`Run failed with status: ${run.status}`);
    }

    // Get the assistant's response
    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMessage = messages.data.find(m => m.role === 'assistant');

    if (!assistantMessage) {
      throw new Error('No response from assistant');
    }

    // Extract text content
    const textContent = assistantMessage.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in response');
    }

    const answer = textContent.text.value;

    // Extract citations from annotations
    const citations = textContent.text.annotations?.map(annotation => ({
      text: annotation.text,
      file_citation: 'file_citation' in annotation ? annotation.file_citation : undefined,
    })) || [];

    // Clean up: delete the temporary assistant
    await openai.beta.assistants.delete(assistant.id);
    // Note: threads.delete is not available in current SDK, threads auto-expire

    return {
      answer,
      citations: citations.length > 0 ? citations : undefined,
    };
  } catch (error: any) {
    console.error('Error querying with Assistant:', error);
    throw new Error(`Failed to query: ${error.message}`);
  }
}

/**
 * Delete a Vector Store
 */
export async function deleteVectorStore(vectorStoreId: string): Promise<void> {
  try {
    await openai.vectorStores.delete(vectorStoreId);
  } catch (error: any) {
    console.error('Error deleting Vector Store:', error);
    throw new Error(`Failed to delete Vector Store: ${error.message}`);
  }
}

/**
 * List all files in a Vector Store
 */
export async function listFilesInVectorStore(vectorStoreId: string): Promise<any[]> {
  try {
    const files = await openai.vectorStores.files.list(vectorStoreId);
    return files.data;
  } catch (error: any) {
    console.error('Error listing files:', error);
    throw new Error(`Failed to list files: ${error.message}`);
  }
}

/**
 * Delete a file from a Vector Store
 */
export async function deleteFileFromVectorStore(
  vectorStoreId: string,
  fileId: string
): Promise<void> {
  try {
    await openai.vectorStores.files.delete(fileId, { vector_store_id: vectorStoreId });
  } catch (error: any) {
    console.error('Error deleting file:', error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

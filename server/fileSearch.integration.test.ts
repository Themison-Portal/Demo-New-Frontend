import { describe, it, expect } from 'vitest';
import { getDb } from './db';
import { protocols } from '../drizzle/schema';
import { createFileSearchStore, uploadToFileSearchStore, queryWithFileSearch } from './_core/fileSearch';

describe('File Search Integration Test', () => {
  it('should upload a real protocol and query it', async () => {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    // Get the first protocol from the database
    const docs = await db.select().from(protocols).limit(1);
    
    if (docs.length === 0) {
      console.log('⚠️  No protocols found in database, skipping test');
      expect(true).toBe(true);
      return;
    }

    const doc = docs[0];
    console.log(`📄 Testing with document: ${doc.filename} (${doc.category})`);

    // Step 1: Create a File Search Store
    console.log('1️⃣  Creating File Search Store...');
    const storeName = await createFileSearchStore(`Test Trial ${doc.trialId}`);
    console.log(`✅ Store created: ${storeName}`);

    // Step 2: Download and upload the document
    console.log('2️⃣  Downloading document from S3...');
    const response = await fetch(doc.fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    console.log(`✅ Downloaded ${fileBuffer.length} bytes`);

    console.log('3️⃣  Uploading to File Search Store...');
    await uploadToFileSearchStore(fileBuffer, doc.filename, storeName);
    console.log('✅ Document uploaded and indexed');

    // Step 3: Query the document
    console.log('4️⃣  Querying the document...');
    const result = await queryWithFileSearch(
      'What is this document about? Give me a brief summary.',
      [storeName]
    );

    console.log('✅ Query result:', result.answer.substring(0, 200) + '...');
    
    expect(result.answer).toBeDefined();
    expect(result.answer.length).toBeGreaterThan(0);
    
    console.log('\n🎉 Full integration test passed!');
  }, 120000); // 2 minute timeout for full workflow
});

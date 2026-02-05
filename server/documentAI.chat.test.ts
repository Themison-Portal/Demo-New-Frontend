import { describe, it, expect } from 'vitest';
import { appRouter } from './routers';

describe('documentAI.chat', () => {
  it('should successfully call Gemini API with valid API key', async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    const result = await caller.documentAI.chat({
      messages: [
        {
          role: 'user',
          content: 'Hello, can you help me with clinical trials?',
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
    // Should not be the error message
    expect(result.message).not.toContain('unable to generate a response');
  });

  it('should return valid response structure', async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    const result = await caller.documentAI.chat({
      messages: [
        {
          role: 'user',
          content: 'Hello',
        },
      ],
    });

    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  }, 10000);

  it('should accept documentIds parameter for granular document selection', async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    // Test with specific document IDs (converted to strings as per API contract)
    const result = await caller.documentAI.chat({
      messages: [
        {
          role: 'user',
          content: 'What is this protocol about?',
        },
      ],
      documentIds: ['1', '2'], // Specific documents
    });

    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(typeof result.message).toBe('string');
  }, 15000);

  it('should use general LLM when no documentIds provided', async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    // Test without documentIds - should use general LLM
    const result = await caller.documentAI.chat({
      messages: [
        {
          role: 'user',
          content: 'What is a clinical trial?',
        },
      ],
      // No documentIds - should trigger general LLM path
    });

    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  }, 10000);
});

import { describe, it, expect } from 'vitest';
import { ENV } from './_core/env';

describe('OpenAI API Key Validation', () => {
  it('should successfully call OpenAI API with the provided key', async () => {
    // Check if API key is set
    expect(ENV.openaiApiKey).toBeDefined();
    expect(ENV.openaiApiKey).not.toBe('');

    // Make a simple API call to validate the key
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENV.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    // Check if the API call was successful
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('data');
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
  }, 10000); // 10 second timeout for API call
});

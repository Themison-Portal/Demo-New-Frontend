import { describe, it, expect, beforeAll } from 'vitest';
import { appRouter } from './routers';

describe('trials.update', () => {
  const caller = appRouter.createCaller({
    user: { id: 1, openId: 'test-user', name: 'Test User', email: 'test@example.com', role: 'admin' },
    req: {} as any,
    res: {} as any,
  });

  const testTrialId = 'test-trial-update-' + Date.now();

  beforeAll(async () => {
    // Create a test trial
    await caller.trials.create({
      id: testTrialId,
      title: 'Original Title',
      protocolNumber: 'TEST-001',
      description: 'Original description',
      phase: 'Phase I',
      status: 'active',
      sponsor: 'Test Sponsor',
      location: 'Test Location',
      enrolledPatients: 0,
      targetPatients: 10,
      completionPercentage: 0,
    });
  });

  it('should update trial title', async () => {
    const result = await caller.trials.update({
      id: testTrialId,
      title: 'Updated Title',
    });

    expect(result).toBeDefined();
    expect(result?.title).toBe('Updated Title');
  });

  it('should update trial protocol number', async () => {
    const result = await caller.trials.update({
      id: testTrialId,
      protocolNumber: 'TEST-002',
    });

    expect(result).toBeDefined();
    expect(result?.protocolNumber).toBe('TEST-002');
  });

  it('should update trial description', async () => {
    const result = await caller.trials.update({
      id: testTrialId,
      description: 'Updated description with more details',
    });

    expect(result).toBeDefined();
    expect(result?.description).toBe('Updated description with more details');
  });

  it('should update trial phase', async () => {
    const result = await caller.trials.update({
      id: testTrialId,
      phase: 'Phase II',
    });

    expect(result).toBeDefined();
    expect(result?.phase).toBe('Phase II');
  });

  it('should update trial sponsor', async () => {
    const result = await caller.trials.update({
      id: testTrialId,
      sponsor: 'New Sponsor Inc.',
    });

    expect(result).toBeDefined();
    expect(result?.sponsor).toBe('New Sponsor Inc.');
  });

  it('should update trial location', async () => {
    const result = await caller.trials.update({
      id: testTrialId,
      location: 'New York, USA',
    });

    expect(result).toBeDefined();
    expect(result?.location).toBe('New York, USA');
  });

  it('should update trial start date', async () => {
    const dateString = '2024-01-15';
    const result = await caller.trials.update({
      id: testTrialId,
      startDate: dateString,
    });

    expect(result).toBeDefined();
    expect(result?.startDate).toBeDefined();
    // Check that the date was saved correctly
    const savedDate = result?.startDate ? new Date(result.startDate).toISOString().split('T')[0] : null;
    expect(savedDate).toBe(dateString);
  });

  it('should update trial end date', async () => {
    const dateString = '2025-12-31';
    const result = await caller.trials.update({
      id: testTrialId,
      endDate: dateString,
    });

    expect(result).toBeDefined();
    expect(result?.endDate).toBeDefined();
    // Check that the date was saved correctly
    const savedDate = result?.endDate ? new Date(result.endDate).toISOString().split('T')[0] : null;
    expect(savedDate).toBe(dateString);
  });

  it('should update multiple fields at once', async () => {
    const result = await caller.trials.update({
      id: testTrialId,
      title: 'Multi-Update Title',
      phase: 'Phase III',
      sponsor: 'Multi-Update Sponsor',
    });

    expect(result).toBeDefined();
    expect(result?.title).toBe('Multi-Update Title');
    expect(result?.phase).toBe('Phase III');
    expect(result?.sponsor).toBe('Multi-Update Sponsor');
  });

  it('should persist the updated trial (read-back via the BE)', async () => {
    // Update via tRPC
    await caller.trials.update({
      id: testTrialId,
      title: 'Database Verification Title',
    });

    // Trials are BE-owned now — verify persistence through the read path
    // (the FE `trials` table is retired) rather than a direct DB read.
    const trial = await caller.trials.getById({ id: testTrialId });

    expect(trial).toBeDefined();
    expect(trial?.title).toBe('Database Verification Title');
  });
});

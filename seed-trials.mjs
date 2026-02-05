import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './drizzle/schema.ts';
import dotenv from 'dotenv';

dotenv.config();

const mockTrials = [
  {
    id: 'abc-123',
    title: 'Phase III Diabetes Study',
    protocolNumber: 'DIAB-2024-001',
    description: 'A randomized, double-blind, placebo-controlled study evaluating the efficacy and safety of a novel diabetes medication in adults with type 2 diabetes.',
    phase: 'Phase III',
    status: 'active',
    sponsor: 'Novo Nordisk',
    location: 'Copenhagen, Denmark',
    enrolledPatients: 12,
    targetPatients: 50,
    completionPercentage: 24,
  },
  {
    id: 'def-456',
    title: 'Oncology Trial',
    protocolNumber: 'ONC-2024-002',
    description: 'Phase II clinical trial investigating a targeted therapy for advanced non-small cell lung cancer patients with specific biomarkers.',
    phase: 'Phase II',
    status: 'recruiting',
    sponsor: 'Roche',
    location: 'Basel, Switzerland',
    enrolledPatients: 8,
    targetPatients: 30,
    completionPercentage: 27,
  },
  {
    id: 'ghi-789',
    title: 'Cardiovascular Study',
    protocolNumber: 'CARDIO-2024-003',
    description: 'Multi-center study assessing the long-term cardiovascular outcomes of a novel anticoagulant in patients with atrial fibrillation.',
    phase: 'Phase III',
    status: 'active',
    sponsor: 'Pfizer',
    location: 'New York, USA',
    enrolledPatients: 25,
    targetPatients: 100,
    completionPercentage: 25,
  },
  {
    id: 'jkl-012',
    title: 'Neurology Research',
    protocolNumber: 'NEURO-2024-004',
    description: 'First-in-human study evaluating the safety, tolerability, and pharmacokinetics of an investigational drug for Alzheimer\'s disease.',
    phase: 'Phase I',
    status: 'recruiting',
    sponsor: 'Biogen',
    location: 'Boston, USA',
    enrolledPatients: 3,
    targetPatients: 15,
    completionPercentage: 20,
  },
  {
    id: 'mno-345',
    title: 'Respiratory Trial',
    protocolNumber: 'RESP-2024-005',
    description: 'Phase II trial investigating a novel inhaled therapy for patients with chronic obstructive pulmonary disease (COPD).',
    phase: 'Phase II',
    status: 'active',
    sponsor: 'AstraZeneca',
    location: 'Cambridge, UK',
    enrolledPatients: 18,
    targetPatients: 60,
    completionPercentage: 30,
  },
  {
    id: 'pqr-678',
    title: 'Immunology Study',
    protocolNumber: 'IMMUNO-2024-006',
    description: 'Large-scale study evaluating a biologic therapy for moderate to severe rheumatoid arthritis in adult patients.',
    phase: 'Phase III',
    status: 'active',
    sponsor: 'Johnson & Johnson',
    location: 'New Brunswick, USA',
    enrolledPatients: 45,
    targetPatients: 120,
    completionPercentage: 38,
  },
  {
    id: 'stu-901',
    title: 'Dermatology Research',
    protocolNumber: 'DERM-2024-007',
    description: 'Phase II study investigating a topical treatment for moderate to severe atopic dermatitis in adolescents and adults.',
    phase: 'Phase II',
    status: 'recruiting',
    sponsor: 'Galderma',
    location: 'Lausanne, Switzerland',
    enrolledPatients: 6,
    targetPatients: 25,
    completionPercentage: 24,
  },
  {
    id: 'vwx-234',
    title: 'Gastroenterology Trial',
    protocolNumber: 'GASTRO-2024-008',
    description: 'Phase III trial evaluating a novel treatment for inflammatory bowel disease (IBD) in patients with inadequate response to standard therapies.',
    phase: 'Phase III',
    status: 'on-hold',
    sponsor: 'Takeda',
    location: 'Osaka, Japan',
    enrolledPatients: 32,
    targetPatients: 80,
    completionPercentage: 40,
  },
];

async function seedTrials() {
  console.log('🌱 Seeding trials...');
  
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const db = drizzle(connection, { schema, mode: 'default' });

  // Insert trials with a default createdBy user ID (1)
  // In a real scenario, you'd use an actual user ID from your users table
  for (const trial of mockTrials) {
    try {
      await db.insert(schema.trials).values({
        ...trial,
        createdBy: 1, // Default user ID
      });
      console.log(`✅ Inserted trial: ${trial.id} - ${trial.title}`);
    } catch (error) {
      // If trial already exists, update it instead
      if (error.code === 'ER_DUP_ENTRY') {
        console.log(`⚠️  Trial ${trial.id} already exists, skipping...`);
      } else {
        console.error(`❌ Error inserting trial ${trial.id}:`, error);
      }
    }
  }

  await connection.end();
  console.log('✅ Seeding complete!');
}

seedTrials().catch((error) => {
  console.error('❌ Seeding failed:', error);
  process.exit(1);
});

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './drizzle/schema.ts';
import { eq, desc } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client, { schema });

async function seedWizardDemo() {
  console.log('Starting Study Setup Wizard demo seed...');

  // Get the first protocol ID (assuming test-protocol.pdf was uploaded)
  const protocols = await db.select().from(schema.protocols).limit(1);
  
  if (protocols.length === 0) {
    console.error('No protocols found! Please upload a protocol first.');
    process.exit(1);
  }

  const protocolId = protocols[0].id;
  const trialId = protocols[0].trialId;
  
  console.log(`Using protocol ID: ${protocolId}, trial ID: ${trialId}`);

  // Create task scaffold
  await db.insert(schema.taskScaffolds).values({
    protocolId,
    trialId,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Get the created scaffold
  const taskScaffolds = await db.select().from(schema.taskScaffolds)
    .where(eq(schema.taskScaffolds.protocolId, protocolId))
    .orderBy(desc(schema.taskScaffolds.createdAt))
    .limit(1);
  
  const taskScaffold = taskScaffolds[0];
  console.log(`Created task scaffold ID: ${taskScaffold.id}`);

  // Create sections (Protocol Map)
  const sections = [
    { name: 'Screening Phase', description: 'Patient screening and eligibility assessment', order: 1, color: '#3B82F6' },
    { name: 'Treatment Phase', description: 'Active treatment administration and monitoring', order: 2, color: '#10B981' },
    { name: 'Follow-up Phase', description: 'Post-treatment monitoring and data collection', order: 3, color: '#F59E0B' },
    { name: 'Study Closeout', description: 'Final assessments and study closure activities', order: 4, color: '#8B5CF6' },
  ];

  for (const section of sections) {
    await db.insert(schema.scaffoldSections).values({
      scaffoldId: taskScaffold.id,
      ...section,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`Created section: ${section.name}`);
  }

  // Get created sections
  const createdSections = await db.select().from(schema.scaffoldSections)
    .where(eq(schema.scaffoldSections.scaffoldId, taskScaffold.id))
    .orderBy(schema.scaffoldSections.order);

  // Create tasks for each section
  const tasks = [
    // Screening Phase tasks
    {
      sectionId: createdSections[0].id,
      name: 'IRB/IEC Approval',
      description: 'Obtain Institutional Review Board or Independent Ethics Committee approval',
      duration: 30,
      order: 1,
      assignedRole: 'Regulatory Affairs',
    },
    {
      sectionId: createdSections[0].id,
      name: 'Site Initiation Visit',
      description: 'Conduct site initiation visit and training for study staff',
      duration: 5,
      order: 2,
      assignedRole: 'Clinical Research Associate',
    },
    {
      sectionId: createdSections[0].id,
      name: 'Patient Recruitment',
      description: 'Recruit and screen potential study participants',
      duration: 60,
      order: 3,
      assignedRole: 'Study Coordinator',
    },
    {
      sectionId: createdSections[0].id,
      name: 'Informed Consent',
      description: 'Obtain informed consent from eligible participants',
      duration: 1,
      order: 4,
      assignedRole: 'Principal Investigator',
    },
    {
      sectionId: createdSections[0].id,
      name: 'Baseline Assessments',
      description: 'Complete baseline clinical assessments and laboratory tests',
      duration: 7,
      order: 5,
      assignedRole: 'Study Nurse',
    },

    // Treatment Phase tasks
    {
      sectionId: createdSections[1].id,
      name: 'Randomization',
      description: 'Randomize participants to treatment arms',
      duration: 1,
      order: 1,
      assignedRole: 'Study Coordinator',
    },
    {
      sectionId: createdSections[1].id,
      name: 'Drug Dispensing',
      description: 'Dispense investigational product to participants',
      duration: 1,
      order: 2,
      assignedRole: 'Pharmacist',
    },
    {
      sectionId: createdSections[1].id,
      name: 'Treatment Administration',
      description: 'Administer treatment according to protocol schedule',
      duration: 84,
      order: 3,
      assignedRole: 'Study Nurse',
    },
    {
      sectionId: createdSections[1].id,
      name: 'Safety Monitoring',
      description: 'Monitor and document adverse events and safety parameters',
      duration: 84,
      order: 4,
      assignedRole: 'Principal Investigator',
    },
    {
      sectionId: createdSections[1].id,
      name: 'Efficacy Assessments',
      description: 'Conduct scheduled efficacy assessments and measurements',
      duration: 84,
      order: 5,
      assignedRole: 'Study Coordinator',
    },

    // Follow-up Phase tasks
    {
      sectionId: createdSections[2].id,
      name: 'End of Treatment Visit',
      description: 'Complete end of treatment assessments',
      duration: 1,
      order: 1,
      assignedRole: 'Principal Investigator',
    },
    {
      sectionId: createdSections[2].id,
      name: 'Follow-up Visits',
      description: 'Conduct scheduled follow-up visits',
      duration: 90,
      order: 2,
      assignedRole: 'Study Coordinator',
    },
    {
      sectionId: createdSections[2].id,
      name: 'Long-term Safety Monitoring',
      description: 'Monitor long-term safety and collect adverse event data',
      duration: 90,
      order: 3,
      assignedRole: 'Study Nurse',
    },

    // Study Closeout tasks
    {
      sectionId: createdSections[3].id,
      name: 'Data Lock',
      description: 'Complete data entry and lock database',
      duration: 14,
      order: 1,
      assignedRole: 'Data Manager',
    },
    {
      sectionId: createdSections[3].id,
      name: 'Statistical Analysis',
      description: 'Perform statistical analysis of study data',
      duration: 30,
      order: 2,
      assignedRole: 'Biostatistician',
    },
    {
      sectionId: createdSections[3].id,
      name: 'Final Study Report',
      description: 'Prepare and submit final clinical study report',
      duration: 60,
      order: 3,
      assignedRole: 'Medical Writer',
    },
    {
      sectionId: createdSections[3].id,
      name: 'Site Closeout Visit',
      description: 'Conduct site closeout visit and archive study documents',
      duration: 5,
      order: 4,
      assignedRole: 'Clinical Research Associate',
    },
  ];

  for (const task of tasks) {
    await db.insert(schema.scaffoldTasks).values({
      scaffoldId: taskScaffold.id,
      ...task,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  console.log(`Created ${tasks.length} tasks across ${sections.length} sections`);

  // Create some task dependencies
  const allTasks = await db.select().from(schema.scaffoldTasks)
    .where(eq(schema.scaffoldTasks.scaffoldId, taskScaffold.id));
  
  // Example dependencies: IRB Approval -> Site Initiation -> Patient Recruitment
  const dependencies = [
    { from: 'IRB/IEC Approval', to: 'Site Initiation Visit' },
    { from: 'Site Initiation Visit', to: 'Patient Recruitment' },
    { from: 'Patient Recruitment', to: 'Informed Consent' },
    { from: 'Informed Consent', to: 'Baseline Assessments' },
    { from: 'Baseline Assessments', to: 'Randomization' },
    { from: 'Randomization', to: 'Drug Dispensing' },
    { from: 'Drug Dispensing', to: 'Treatment Administration' },
    { from: 'Treatment Administration', to: 'End of Treatment Visit' },
    { from: 'End of Treatment Visit', to: 'Follow-up Visits' },
    { from: 'Follow-up Visits', to: 'Data Lock' },
    { from: 'Data Lock', to: 'Statistical Analysis' },
    { from: 'Statistical Analysis', to: 'Final Study Report' },
  ];

  for (const dep of dependencies) {
    const fromTask = allTasks.find(t => t.name === dep.from);
    const toTask = allTasks.find(t => t.name === dep.to);
    
    if (fromTask && toTask) {
      await db.insert(schema.taskDependencies).values({
        fromTaskId: fromTask.id,
        toTaskId: toTask.id,
        createdAt: new Date(),
      });
      console.log(`Created dependency: ${dep.from} -> ${dep.to}`);
    }
  }

  console.log('Demo seed completed successfully!');
  await client.end();
}

seedWizardDemo().catch(console.error);

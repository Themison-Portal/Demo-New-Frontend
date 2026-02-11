import { and, eq } from 'drizzle-orm';
import { protocolChunks } from '../drizzle/schema';
import { getDb } from '../server/db';

async function run() {
  const db = await getDb();
  if (!db) throw new Error('no db');
  const rows = await db
    .select({ id: protocolChunks.id, metadata: protocolChunks.metadata, chunkText: protocolChunks.chunkText, pageStart: protocolChunks.pageStart, pageEnd: protocolChunks.pageEnd })
    .from(protocolChunks)
    .where(and(eq(protocolChunks.protocolId, 330001), eq(protocolChunks.sectionTitle, 'Schedule of Activities (structured)')))
    .limit(1);
  if (!rows.length) {
    console.log('no rows');
    return;
  }
  const row = rows[0] as any;
  const structured = row.metadata?.structuredSchedule;
  const entries = Array.isArray(structured?.entries) ? structured.entries : [];
  console.log('chunk', { id: row.id, pageStart: row.pageStart, pageEnd: row.pageEnd, entries: entries.length });
  console.log('visits', (structured?.visits || []).map((v: any) => `${v.name}${v.day ? ' (' + v.day + ')' : ''}`));
  const pregnancy = entries.filter((e: any) => String(e.procedure || '').toLowerCase().includes('pregnancy'));
  const c1d2 = entries.filter((e: any) => String(e.visit || '').toLowerCase().includes('cycle 1 day 2') && e.required);
  console.log('pregnancy entries', pregnancy);
  console.log('c1d2 required count', c1d2.length);
  console.log('c1d2 procedures', c1d2.map((e: any) => e.procedure));
  console.log('sourcePages', structured?.sourcePages);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

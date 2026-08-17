import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { protocols } from './drizzle/schema.ts';
import * as dotenv from 'dotenv';

dotenv.config();

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

const allProtocols = await db.select().from(protocols);

console.log('Protocols in database:');
console.log(JSON.stringify(allProtocols, null, 2));

await client.end();

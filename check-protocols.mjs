import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { protocols } from './drizzle/schema.ts';
import * as dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

const allProtocols = await db.select().from(protocols);

console.log('Protocols in database:');
console.log(JSON.stringify(allProtocols, null, 2));

await connection.end();

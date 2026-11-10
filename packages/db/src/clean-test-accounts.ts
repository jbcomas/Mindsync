// Limpia de la base de DESARROLLO las cuentas creadas por tests y pruebas manuales (emails @test.local).
// Usa la misma función que usa el producto (ms_delete_account), así que también sirve de prueba.
// Por defecto es un ensayo (no borra nada). Para borrar: npm run db:clean-test-accounts -- --yes
import pg from 'pg';
import { createTenantDb } from './tenant.js';
import { urls } from './config.js';

const SUFFIX = '@test.local';
const yes = process.argv.includes('--yes');

const admin = new pg.Pool({ connectionString: urls.admin, max: 1 });
const rows = (await admin.query('SELECT id, email FROM users WHERE email LIKE $1 ORDER BY created_at', [`%${SUFFIX}`])).rows as { id: string; email: string }[];
const others = (await admin.query('SELECT count(*)::int n FROM users WHERE email NOT LIKE $1', [`%${SUFFIX}`])).rows[0].n as number;
await admin.end();

console.log(`Base: ${new URL(urls.app).pathname.slice(1)}`);
console.log(`Cuentas ${SUFFIX} encontradas: ${rows.length}`);
console.log(`Cuentas NO de prueba (no se tocan): ${others}`);
if (!yes) { console.log('\nEnsayo: no se borró nada. Para borrar de verdad: npm run db:clean-test-accounts -- --yes'); process.exit(0); }

const db = createTenantDb(urls.app, { max: 2 });
let ok = 0, skipped = 0;
for (const u of rows) {
  if (!u.email.endsWith(SUFFIX)) { skipped++; continue; }        // doble guardia
  try { await db.withTenant(u.id, tx => tx.query('SELECT ms_delete_account()')); ok++; }
  catch (e) { skipped++; console.log(`  omitida ${u.email}: ${(e as Error).message}`); }
}
await db.close();
console.log(`\nBorradas: ${ok} · omitidas: ${skipped} · cuentas no de prueba intactas: ${others}`);

// node scripts/validate.mjs schemas/<name>.schema.json <file.json>
// или: node scripts/validate.mjs <name> <file.json>
import { validate, readJson, loadSchema, exists } from './lib.mjs';

const [schemaArg, file] = process.argv.slice(2);
if (!schemaArg || !file) { console.error('usage: validate.mjs <schema|name> <file.json>'); process.exit(2); }
const schema = schemaArg.endsWith('.json') ? readJson(schemaArg) : loadSchema(schemaArg);
if (!exists(file)) { console.error(`нет файла: ${file}`); process.exit(2); }
let data;
try { data = readJson(file); } catch (e) { console.error(`невалидный JSON: ${file}: ${e.message}`); process.exit(1); }
const errors = validate(schema, data);
if (errors.length) {
  console.log(`FAIL ${file}: ${errors.length} ошибок`);
  errors.slice(0, 50).forEach(e => console.log(' - ' + e));
  process.exit(1);
}
console.log(`OK ${file}`);

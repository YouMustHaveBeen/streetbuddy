// Deletes one address of the directory of the D1 database streetbuddy by its text. Shows the address
// and deletes it only after the answer y. If no address or several addresses have this text, nothing is deleted.
// Run from the project folder: node scripts/delete-address.mjs "Main St, Block 1b"
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const TEXT = process.argv[2];
if (!TEXT) {
  console.error('Name the address, for example: node scripts/delete-address.mjs "Main St, Block 1b"');
  process.exit(1);
}
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function query(sql) {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", "streetbuddy", "--remote", "--json", `--command=${sql}`], {
    shell: process.platform === "win32",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["inherit", "pipe", "inherit"],
  });
  try {
    return JSON.parse(result.stdout)[0].results;
  } catch {
    console.error(`The database did not answer:\n${result.stdout ?? ""}`);
    process.exit(1);
  }
}

const select = `SELECT id, text, kind, source, geometry FROM addresses WHERE text = ${quote(TEXT)}`;
const rows = query(select);
if (rows.length === 0) {
  console.error(`No address with the text "${TEXT}" (write it exactly as in the directory).`);
  process.exit(1);
}
if (rows.length > 1) {
  console.error(`${rows.length} addresses have the text "${TEXT}", nothing deleted. Delete this one in /admin.`);
  process.exit(1);
}
const [row] = rows;
console.log(`Will be deleted: "${row.text}", ${JSON.parse(row.geometry).type} (${row.kind}), source ${row.source}`);

const input = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await input.question("Delete it? (y/n) ")).trim().toLowerCase();
input.close();
if (answer !== "y") {
  console.log("Nothing deleted.");
  process.exit(0);
}

query(`DELETE FROM addresses WHERE id = ${Number(row.id)} AND text = ${quote(row.text)} AND geometry = ${quote(row.geometry)}`);
if (query(`SELECT id FROM addresses WHERE id = ${Number(row.id)}`).length > 0) {
  console.error("The address is still in the directory. Delete it in /admin.");
  process.exit(1);
}
console.log("Deleted and checked.");

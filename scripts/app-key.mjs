// Prepares an app's Firebase key for Vercel. Run it yourself: npm run desk:app-key
// It checks the key is for that app's project, and writes .env.desk (never committed).
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { DESK_APPS } from "../src/lib/apps.ts";
import { keyFitsProject } from "../src/lib/rules.ts";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const slug = (await rl.question(`Which app (${DESK_APPS.map((a) => a.slug).join(", ")}) [drivsync]: `)).trim() || "drivsync";
const app = DESK_APPS.find((a) => a.slug === slug);
if (!app) {
  console.error("Desk doesn't know that app.");
  process.exit(1);
}
const keyPath = (await rl.question("Path of the app's key file: ")).trim().replace(/^"|"$/g, "");
rl.close();

const text = readFileSync(keyPath, "utf8");
const projectId = JSON.parse(text).project_id;
if (!keyFitsProject(projectId, app.firebaseProject)) {
  console.error(`This key is for "${projectId}", but ${app.title} expects "${app.firebaseProject ?? "a project not set yet in src/lib/apps.ts"}".`);
  process.exit(1);
}
const name = `APP_${slug.toUpperCase()}_FIREBASE_KEY_B64`;
writeFileSync(".env.desk", `${name}=${Buffer.from(text).toString("base64")}\n`, { mode: 0o600 });
console.log(`\nDone: ${name} is in .env.desk. Add it to Vercel, Production only, then delete .env.desk and the key file.\n`);

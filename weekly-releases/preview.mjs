import { readFile, writeFile } from 'node:fs/promises';
import { render } from './render.mjs';
const r=JSON.parse(await readFile(new URL('./release-1.json',import.meta.url)));
await writeFile('/private/tmp/weekly-release-preview.html',render(r,[{number:1,date:r.date}]));

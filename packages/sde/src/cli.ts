import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { buildUniverse, formatUniverse, parseJsonl, SDE_FILES, type SdeInput } from './build.js';
import { UNIVERSE_DATA_FILE } from './index.js';
import { readZipEntries } from './zip.js';

// Builds data/universe.json: `pnpm --filter @darkbeacon/sde universe [--from <url|zip>] [--out <file>]`.

const LATEST = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: LATEST },
    out: { type: 'string', default: UNIVERSE_DATA_FILE },
  },
});

async function fetchZip(source: string): Promise<Buffer> {
  if (!/^https?:\/\//.test(source)) return readFile(source);
  console.log(`downloading ${source}`);
  const response = await fetch(source, { headers: { 'user-agent': 'Darkbeacon SDE builder' } });
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

const entries = readZipEntries(await fetchZip(values.from), Object.values(SDE_FILES));
const read = <T>(name: string) => parseJsonl<T>(entries.get(name)!.toString('utf8'));
const input: SdeInput = {
  meta: read<SdeInput['meta']>(SDE_FILES.meta)[0]!,
  regions: read(SDE_FILES.regions),
  constellations: read(SDE_FILES.constellations),
  systems: read(SDE_FILES.systems),
  stargates: read(SDE_FILES.stargates),
};
const data = buildUniverse(input);
await writeFile(values.out, formatUniverse(data));
console.log(
  `${data.source}: ${data.systems.length} systems in ${data.regions.length} regions -> ${values.out}`,
);

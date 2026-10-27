import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

let buildTime: number;
try { buildTime = (await stat('apps/web/.next/BUILD_ID')).mtimeMs; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; throw new Error('Build client assets before checking.'); }

async function srcFiles(dir: string): Promise<string[]> {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => {
    if (e.isDirectory()) return (e.name === 'node_modules' || e.name === '.next') ? [] : srcFiles(path.join(dir, e.name));
    return /\.(ts|tsx|js|jsx|mjs|cjs|css|json)$/.test(e.name) ? [path.join(dir, e.name)] : [];
  }))).flat();
}
const sources = ['package.json', 'tsconfig.json', ...await srcFiles('apps/web'), ...await srcFiles('packages')];
const stats = await Promise.all(sources.map(async p => ({ path: p, mtime: (await stat(p)).mtimeMs })));
const newest = stats.reduce((max, cur) => cur.mtime > max.mtime ? cur : max);
if (newest.mtime > buildTime) throw new Error(`Stale build: ${newest.path} changed after the last build. Run npm run build first.`);

async function files(dir:string):Promise<string[]>{return(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();}
const paths=await files('apps/web/.next/static');
if(!paths.length)throw new Error('Build client assets before checking.');
try { process.loadEnvFile?.('.env'); } catch {}
const marker=['SUPABASE','SECRET','KEY'].join('_'),secret=process.env[marker];
for(const file of paths){const text=await readFile(file,'utf8');if(text.includes(marker)||(secret&&text.includes(secret)))throw new Error(`Server credential found in client asset: ${file}`);}
console.log('PASS: no server credential name or configured value in client assets');

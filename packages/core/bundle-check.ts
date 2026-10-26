import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
async function files(dir:string):Promise<string[]>{return(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();}
const paths=await files('apps/web/.next/static');
if(!paths.length)throw new Error('Build client assets before checking.');
try { process.loadEnvFile?.('.env'); } catch {}
const marker=['SUPABASE','SECRET','KEY'].join('_'),secret=process.env[marker];
for(const file of paths){const text=await readFile(file,'utf8');if(text.includes(marker)||(secret&&text.includes(secret)))throw new Error(`Server credential found in client asset: ${file}`);}
console.log('PASS: no server credential name or configured value in client assets');

import { spawn } from 'node:child_process';
try { process.loadEnvFile?.('.env'); } catch {}
const offline=process.argv.includes('--offline');
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','apps/web'],{stdio:'inherit',env:{...process.env,...(offline?{DEVLENS_OFFLINE:'1'}:{})}});
child.on('exit',code=>process.exit(code??1));

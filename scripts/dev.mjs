// Starts several dev servers at once with labelled output; Ctrl+C stops them all.
//   node scripts/dev.mjs admin instructor          → both websites
//   node scripts/dev.mjs admin instructor mobile   → both websites + the Expo app
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = {
  admin: { cwd: 'admin-web', cmd: 'npm run dev', color: 33, label: 'admin      :5173' },
  instructor: { cwd: 'instructor-web', cmd: 'npm run dev', color: 36, label: 'instructor :5174' },
  mobile: { cwd: '.', cmd: 'npx expo start', color: 35, label: 'mobile' },
};

const wanted = process.argv.slice(2);
if (!wanted.length || wanted.some((t) => !TARGETS[t])) {
  console.error(`Usage: node scripts/dev.mjs <${Object.keys(TARGETS).join('|')}> ...`);
  process.exit(1);
}

const children = [];
for (const name of wanted) {
  const t = TARGETS[name];
  const cwd = path.join(root, t.cwd);
  if (t.cwd !== '.' && !existsSync(path.join(cwd, 'node_modules'))) {
    console.error(`[${t.label}] node_modules missing — run: cd ${t.cwd} && npm install`);
    process.exit(1);
  }
  const child = spawn(t.cmd, { cwd, shell: true, env: { ...process.env, FORCE_COLOR: '1' } });
  const tag = `\x1b[${t.color}m[${t.label}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(tag + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${tag}stopped (exit ${code})\n`);
    if (code) stopAll(code);
  });
  children.push(child);
}

function stopAll(code = 0) {
  for (const c of children) if (c.exitCode === null) c.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

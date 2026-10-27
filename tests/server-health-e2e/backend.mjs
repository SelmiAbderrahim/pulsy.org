// Disposable controller: retain fresh secrets while restarting the real OSS entrypoint.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('hex');
process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString('hex');
const publish = (path, value) => {
  writeFileSync(path + '.tmp', value);
  renameSync(path + '.tmp', path);
};
let generation = 0;
let stopping = false;
let child;
const stopChild = () => {
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
};
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { stopping = true; stopChild(); });
}
while (!stopping) {
  child = spawn('sh', ['docker/entrypoint.server.sh'], { stdio: 'inherit', detached: true });
  publish('/fixture/generation', String(++generation));
  let requested = false;
  const timer = setInterval(() => {
    if (existsSync('/fixture/restart-request')) {
      unlinkSync('/fixture/restart-request');
      requested = true;
      stopChild();
    }
  }, 500);
  const code = await new Promise((resolve, reject) => {
    child.on('exit', resolve);
    child.on('error', reject);
  });
  clearInterval(timer);
  if (!stopping && !requested) throw new Error(`Acceptance backend exited unexpectedly (${code})`);
}

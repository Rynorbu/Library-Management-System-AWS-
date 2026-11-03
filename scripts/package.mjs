/**
 * Builds the Elastic Beanstalk source bundle:
 *   1. vite build  -> client/dist
 *   2. copy server/ (without node_modules, .env, uploads) + client/dist -> build/app (public/)
 *   3. zip build/app -> build/library-app.zip  (forward-slash paths, works on Linux EB hosts)
 *   4. zip each Lambda -> build/lambda-*.zip
 *
 *   npm run package
 */
import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, existsSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
const app = path.join(build, 'app');
const EXCLUDE = new Set(['node_modules', '.env', 'uploads', 'public']);

console.log('> building React client');
execSync('npm run build', { cwd: path.join(root, 'client'), stdio: 'inherit' });

rmSync(build, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

console.log('> copying server');
cpSync(path.join(root, 'server'), app, {
  recursive: true,
  filter: (src) => !EXCLUDE.has(path.basename(src)) || path.dirname(src) !== path.join(root, 'server'),
});
cpSync(path.join(root, 'client', 'dist'), path.join(app, 'public'), { recursive: true });

function zip(dir, out) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(out);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(dir, false, (entry) => (entry.name.includes('node_modules') ? false : entry));
    archive.finalize();
  });
}

const bytes = await zip(app, path.join(build, 'library-app.zip'));
console.log(`> build/library-app.zip (${(bytes / 1024).toFixed(0)} KB) - upload this to Elastic Beanstalk`);

for (const fn of ['notifier', 'reminders']) {
  const dir = path.join(root, 'lambda', fn);
  if (!existsSync(dir)) continue;
  const b = await zip(dir, path.join(build, `lambda-${fn}.zip`));
  console.log(`> build/lambda-${fn}.zip (${(b / 1024).toFixed(1)} KB)`);
}

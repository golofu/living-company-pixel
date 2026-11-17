import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '..');
const args = process.argv.slice(2);
const hidden = args.includes('--hidden');
const json = args.includes('--json');
const progress = (event, fields = {}) => { if (json) process.stdout.write(JSON.stringify({ event, ...fields }) + '\n'); };
if (json) console.log = (...items) => progress('progress', { message: items.join(' ') });
const configArg = args.indexOf('--desktop-config');
const desktopConfig = configArg < 0 ? null : JSON.parse(fs.readFileSync(args[configArg + 1], 'utf8').replace(/^\uFEFF/, ''));
const test = args.includes('--test');
const offices = desktopConfig?.offices ?? (test ? [{ key: 'fixture', port: 14327, name: 'ทดสอบบริษัท' }] : [
  { key: 'sample', port: 4317, name: 'บ้านขนมดี' },
]);
const base = test ? path.join(root, '_test') : root;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const psQuote = s => "'" + s.replaceAll("'", "''") + "'";
const encode = s => Buffer.from(s, 'utf16le').toString('base64');
function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode("$ProgressPreference = 'SilentlyContinue'; " + script)], { windowsHide: true, encoding: 'utf8' });
}
async function api(office, route, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${office.port}/api${route}`, {
    method, signal: AbortSignal.timeout(5000),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}
async function occupied(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}
function claudeBinary() {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  try {
    const found = execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
    if (found) return found;
  } catch {}
  const local = path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe');
  if (fs.existsSync(local)) return local;
  throw new Error('ไม่พบ Claude Code: ติดตั้งและ login ก่อนเปิดบริษัท');
}
/** Build again when the page was never built or any client file (code, models, looks) is newer
 * than the last build, e.g. after `git pull` brought new characters. */
function clientIsStale() {
  const built = path.join(repo, 'dist/client/index.html');
  if (!fs.existsSync(built)) return true;
  const at = fs.statSync(built).mtimeMs;
  const newer = dir => fs.readdirSync(dir, { withFileTypes: true }).some(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? newer(p) : fs.statSync(p).mtimeMs > at;
  });
  return newer(path.join(repo, 'src/client')) || newer(path.join(repo, 'src/shared'))
    || fs.statSync(path.join(repo, 'vite.config.ts')).mtimeMs > at;
}
function stop() {
  const listing = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
  const ports = new Set(offices.map(o => o.port));
  const pids = new Set();
  for (const line of listing.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] === 'TCP' && fields[3] === 'LISTENING' && ports.has(Number(fields[1].split(':').pop()))) pids.add(fields[4]);
  }
  for (const pid of pids) {
    console.log(`กำลังปิดเซิร์ฟเวอร์ PID ${pid}`);
    execFileSync('taskkill.exe', ['/PID', pid, '/T', '/F'], { stdio: 'inherit', windowsHide: true });
  }
  console.log(pids.size ? 'ปิดบริษัทแล้ว' : 'ไม่มีบริษัทที่กำลังเปิดบนพอร์ตที่กำหนด');
}
async function main() {
  // Desktop assigns this launcher to its Windows Job before allowing descendants.
  if (args.includes('--desktop-gated')) {
    await new Promise((resolve, reject) => {
      process.stdin.once('data', resolve);
      process.stdin.once('end', () => reject(new Error('desktop closed before launch')));
      process.stdin.resume();
    });
    process.stdin.pause();
  }
  if (args[0] === '--serve') {
    const cfg = JSON.parse(Buffer.from(args[1], 'base64').toString('utf8'));
    const fd = fs.openSync(cfg.log, 'a');
    const child = spawn(process.execPath, [path.join(repo, 'node_modules/tsx/dist/cli.mjs'), 'src/server/main.ts'], {
      cwd: repo, env: { ...process.env, PORT: String(cfg.port), HOST: '127.0.0.1', LANG: 'en_US.UTF-8', LOCALE: 'en_US.UTF-8', AGENT_OFFICE_DATA: cfg.data, CLAUDE_BIN: cfg.claude },
      stdio: ['ignore', fd, fd], windowsHide: true,
    });
    fs.closeSync(fd);
    child.on('error', err => { console.error(err.message); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    return;
  }
  if (process.platform !== 'win32') throw new Error('launcher นี้สำหรับ Windows');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('ต้องใช้ Node.js 22 ขึ้นไป');
  if (args.includes('--stop')) return stop();
  // Desktop can open the office and show installation help even before Claude is installed.
  let claude = '';
  try { claude = claudeBinary(); } catch (err) { if (!hidden) throw err; progress('claude-missing'); }
  if (!fs.existsSync(path.join(repo, 'node_modules/tsx/dist/cli.mjs'))) {
    console.log('ครั้งแรก: กำลังติดตั้งส่วนประกอบ (1-3 นาที)');
    execFileSync('npm.cmd', ['install', '--no-audit', '--no-fund'], { cwd: repo, stdio: json ? ['ignore', 2, 2] : 'inherit', shell: true, windowsHide: hidden });
  }
  if (clientIsStale()) {
    console.log('กำลัง build หน้า 3D ด้วย Vite ที่ติดตั้งไว้');
    execFileSync(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), 'build', '--configLoader', 'native'], { cwd: repo, stdio: json ? ['ignore', 2, 2] : 'inherit', windowsHide: hidden });
  }
  for (const office of offices) {
    const dir = office.data ? path.dirname(office.data) : path.join(base, 'offices', office.key);
    const data = office.data || path.join(dir, 'data');
    const cwd = office.work || path.join(dir, 'งาน');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(data, { recursive: true });
    if (!await occupied(office.port)) {
      console.log(`กำลังเปิด ${office.name} พอร์ต ${office.port}`);
      const log = office.log || path.join(dir, 'server.log');
      const cfg = Buffer.from(JSON.stringify({ ...office, log, data, claude })).toString('base64');
      if (hidden) {
        const fd = fs.openSync(log, 'a');
        const child = spawn(process.execPath, [path.join(repo, 'node_modules/tsx/dist/cli.mjs'), 'src/server/main.ts'], {
          cwd: repo, detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
          env: { ...process.env, PORT: String(office.port), HOST: '127.0.0.1', LANG: 'en_US.UTF-8', LOCALE: 'en', AGENT_OFFICE_DATA: data, ...(claude ? { CLAUDE_BIN: claude } : {}) },
        });
        fs.closeSync(fd);
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        progress('started', { key: office.key, port: office.port, pid: child.pid, data, log });
        child.unref();
      } else {
        const script = `$host.UI.RawUI.WindowTitle = ${psQuote(office.name)}; & ${psQuote(process.execPath)} ${psQuote(fileURLToPath(import.meta.url))} --serve ${psQuote(cfg)}`;
        powershell(`Start-Process powershell.exe -WindowStyle Minimized -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encode(script)}')`);
      }
    } else { console.log(`ใช้เซิร์ฟเวอร์เดิมบนพอร์ต ${office.port}`); progress('reused', { key: office.key, port: office.port }); }
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { const state = await api(office, '/state'); if (!Array.isArray(state.agents)) throw new Error('state ไม่มี agents'); ready = true; break; } catch { await sleep(1000); }
    }
    if (!ready) throw new Error(`${office.name} ไม่พร้อม: ตรวจ ${path.join(dir, 'server.log')} (พอร์ตอาจถูกโปรแกรมอื่นใช้)`);
    progress('ready', { key: office.key, port: office.port });
    if (office.skipImport) continue;
    const rosterFile = office.roster || path.join(base, 'rosters', `${office.key}.json`);
    if (!fs.existsSync(rosterFile)) { console.log(`ยังไม่มี roster: ${rosterFile} จะนำเข้าเมื่อเปิดครั้งถัดไป`); continue; }
    const bytes = fs.readFileSync(rosterFile);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const markerFile = path.join(dir, 'imported.json');
    let marker;
    try { marker = JSON.parse(fs.readFileSync(markerFile, 'utf8')); } catch {}
    if (marker?.sha256 === hash && fs.existsSync(path.join(data, 'state.json'))) { console.log(`${office.name}: ข้ามการนำเข้า (hash เดิม)`); continue; }
    const roster = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (roster.format !== 'agent-office-team' || roster.version !== 1 || !Array.isArray(roster.agents) || !roster.agents.length) throw new Error(`รูปแบบ roster ไม่ถูกต้อง: ${rosterFile}`);
    // Subscription runs report a notional cost, so a dollar cap would stall long chains; cap parallel runs instead to protect RAM.
    const current = await api(office, '/state');
    const limits = { ...current.settings.limits, maxConcurrent: 3, chainBudgetUsd: 0 };
    await api(office, '/settings', 'PUT', { defaultCwd: cwd, officeNotes: roster.officeNotes || '', defaultProvider: 'claude', language: 'en', playerName: 'CEO', limits });
    await api(office, '/office', 'PUT', { name: roster.officeName || office.name });
    await api(office, '/team/import', 'POST', { format: roster.format, version: roster.version, agents: roster.agents, replace: true });
    const state = await api(office, '/state');
    if (state.agents.length !== roster.agents.length) throw new Error(`จำนวนสมาชิกหลังนำเข้าไม่ตรง: ${office.name}`);
    // The server debounces persistence by 250 ms. Do not mark success before it reaches disk.
    let persisted = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const saved = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
        if (JSON.stringify(saved.agents.map(a => a.id)) === JSON.stringify(state.agents.map(a => a.id))) { persisted = true; break; }
      } catch {}
      await sleep(100);
    }
    if (!persisted) throw new Error(`ยังยืนยันการบันทึก data/state.json ไม่ได้: ${office.name}; หากใช้เซิร์ฟเวอร์เดิม ให้ปิดแล้วเปิดด้วย launcher เพื่อใช้ data dir ที่กำหนด`);
    fs.writeFileSync(markerFile, JSON.stringify({ sha256: hash, rosterFile, importedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
    console.log(`${office.name}: นำเข้า ${state.agents.length} คนแล้ว`);
  }
  if (!hidden && !test && !args.includes('--no-browser')) for (const office of offices) powershell(`Start-Process 'http://127.0.0.1:${office.port}'`);
  console.log('พร้อมใช้งานแล้ว');
  progress('complete');
}
main().catch(err => { progress('error', { message: err.message }); console.error(`เปิด/ปิดบริษัทไม่สำเร็จ: ${err.message}`); process.exitCode = 1; });

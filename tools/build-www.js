#!/usr/bin/env node
/**
 * build-www.js —— 生成 Capacitor webDir（www/）
 *
 * 背景：过去 www/ 是「把仓库根整个 cp 过来」产生的，于是 keystore/、screenshots/、
 * samples/、README、package-lock、甚至 www/www 套娃全被 `cap sync` 一路搬进
 * APK 的 assets/public/。v1.7.1 实测：签名密钥 paopao-quiz.jks 被打进了已发布的
 * APK（仓库是 PUBLIC 的），assets 里还白放着 17M 没人读的 quizzes/。
 *
 * 所以这里只认一张白名单：index.html 真正引用的东西 + manifest + 音频。
 * 不在名单里的一律不进包。要新增静态资源，请显式往 FILES / DIRS 里加一行，
 * 不要「顺手全拷」。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

// 顶层单文件
const FILES = ['index.html', 'manifest.json'];

// 顶层目录（整棵递归拷贝）
// js/     —— app.js + data/ 内置题库
// css/    —— style.css
// 注意：audio/ 从 v1.8.0 起**不再打包**。听力改为放在仓库里由 raw.githubusercontent.com 提供，
// 用户播放或开考时下载到 IndexedDB，删题库连带删除 —— 包体因此少 ~3 MB，且不随题库增长。
// 仓库里的 audio/ 仍然是发布源（必须 commit + push，否则线上题库取不到音频），只是不进 APK。
const DIRS = ['js', 'css'];

// 永远不进包，即使被误加进 DIRS 也要拦住
const DENY = new Set([
  'keystore', 'node_modules', 'screenshots', 'samples', 'tmp-build',
  'quizzes', 'android', 'data', '.git', 'tools', 'audio'
]);

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyInto(src, destDir) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === '.DS_Store' || entry.startsWith('._')) continue;
      copyInto(path.join(src, entry), path.join(destDir, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.copyFileSync(src, destDir);
  }
}

function sizeOf(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return st.size;
  return fs.readdirSync(target).reduce((n, e) => n + sizeOf(path.join(target, e)), 0);
}

function human(bytes) {
  return bytes > 1048576
    ? (bytes / 1048576).toFixed(2) + ' MB'
    : (bytes / 1024).toFixed(1) + ' KB';
}

// 版本号三处对齐检查：app.js 的 APP_VERSION 落后于 build.gradle 会造成
// 「发现新版本」弹窗永远消不掉（v1.7.1 就这么翻过一次车）。
function checkVersions() {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const appJs = read('js/app.js').match(/const APP_VERSION\s*=\s*'([^']+)'/);
  const gradle = read('android/app/build.gradle').match(/versionName\s+"([^"]+)"/);
  const pkg = JSON.parse(read('package.json'));

  const found = {
    'js/app.js APP_VERSION': appJs && appJs[1],
    'build.gradle versionName': gradle && gradle[1],
    'package.json version': pkg.version
  };
  const values = Object.values(found).filter(Boolean);
  const consistent = new Set(values).size === 1 && values.length === 3;

  if (!consistent) {
    console.error('❌ 版本号三处不一致，发布前必须对齐：');
    for (const [k, v] of Object.entries(found)) console.error(`   ${k.padEnd(28)} ${v || '(没找到)'}`);
    process.exitCode = 1;
  } else {
    console.log(`版本号一致：v${values[0]}`);
  }
}

// 内置题库是一堆 <script src="js/data/x.js"> 直接赋值，任何一个语法错误都会
// 让那个文件整段不执行 —— 页面不报错、控制台以外看不出问题，症状只是首页少一张卡。
// v1.7.2 就踩了这雷：js/data/ms-daofa.js 的 answerText 里有跨行真实换行，
// 内置的教资面试题库从来没注册成功过。这里把「进包脚本」当发布物对待：
// 1) 每个 .js 必须能通过语法解析；2) index.html 引用的脚本必须存在，
//    存在的 js/data/*.js 也必须被引用（生成了却没挂脚本 = 等于没内置）。
function checkScripts() {
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const bad = [];
  let checked = 0;

  (function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!entry.endsWith('.js')) continue;
      checked++;
      try {
        new vm.Script(fs.readFileSync(p, 'utf8'), { filename: path.relative(OUT, p) });
      } catch (e) {
        bad.push(`语法错误 ${path.relative(OUT, p)}：${e.message}`);
      }
    }
  })(path.join(OUT, 'js'));

  const referenced = [...html.matchAll(/<script\s+[^>]*src="([^"]+)"/g)]
    .map(m => m[1])
    .filter(src => !/^https?:|^\/\//.test(src));
  for (const src of referenced) {
    if (!fs.existsSync(path.join(OUT, src))) bad.push(`index.html 引用了不存在的脚本：${src}`);
  }

  const dataDir = path.join(OUT, 'js', 'data');
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir)) {
      if (!f.endsWith('.js')) continue;
      if (!referenced.includes(`js/data/${f}`)) bad.push(`内置题库 js/data/${f} 没有被 index.html 引用，不会生效`);
    }
  }

  if (bad.length) {
    console.error('❌ 脚本自检未通过：');
    for (const b of bad) console.error('   ' + b);
    process.exitCode = 1;
  } else {
    console.log(`脚本自检通过：${checked} 个 .js 语法有效，index.html 引用 ${referenced.length} 个本地脚本`);
  }
}

// 内置题库（js/data/*.js）与在线镜像（quizzes/）必须是同一份内容。
// 这两份过去各改各的：内置文件被手写坏成 SyntaxError，页面不报错、只是首页少一张卡，
// 而镜像一直是好的 —— 于是「线上有、装包里看不见」。这里在构建时硬核对。
function checkBuiltinDrift() {
  const dataDir = path.join(ROOT, 'js', 'data');
  const quizDir = path.join(ROOT, 'quizzes');
  if (!fs.existsSync(dataDir) || !fs.existsSync(quizDir)) return;

  const mirrors = fs.readdirSync(quizDir).filter(f => f.endsWith('.json'));
  const drift = [];
  let checked = 0;

  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.js')) continue;
    let key, bank;
    try {
      const win = {};
      new vm.Script(fs.readFileSync(path.join(dataDir, f), 'utf8'), { filename: 'js/data/' + f })
        .runInNewContext({ window: win });
      key = Object.keys(win.QUIZ_DATA || {})[0];
      bank = key && win.QUIZ_DATA[key];
      if (!key || !bank) { drift.push(`js/data/${f} 没有给 window.QUIZ_DATA 赋值任何 key`); continue; }
    } catch (e) {
      drift.push(`js/data/${f} 无法解析：${e.message}`);
      continue;
    }
    const mirror = mirrors.find(m => m.slice(0, -5).split('~').pop() === key || m.slice(0, -5) === key);
    if (!mirror) { drift.push(`内置题库 ${key} 在 quizzes/ 里没有镜像，用户删除内置后无法找回`); continue; }
    checked++;
    let mb;
    try { mb = JSON.parse(fs.readFileSync(path.join(quizDir, mirror), 'utf8')); }
    catch (e) { drift.push(`quizzes/${mirror} 解析失败：${e.message}`); continue; }
    if (JSON.stringify(bank.questions) !== JSON.stringify(mb.questions)) {
      const a = bank.questions, b = mb.questions;
      let where = `题量 内置 ${a.length} / 镜像 ${b.length}`;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) { where = `第 ${i + 1} 题内容不同`; break; }
      }
      drift.push(`内置 js/data/${f} 与 quizzes/${mirror} 题目不一致（${where}）—— 改题请改源文件后跑 tools/merge-banks.js --only ${key}`);
    }
  }

  if (drift.length) {
    console.error('❌ 内置题库与在线镜像漂移：');
    for (const d of drift) console.error('   ' + d);
    process.exitCode = 1;
  } else {
    console.log(`内置/镜像一致性通过：${checked} 个内置题库都有镜像且题目相同`);
  }
}

// 音频不再打包之后，唯一的失败模式是「题库里写了 audio/…，仓库里却没有这个文件」：
// 线上取到 404，用户端只显示一句「音频加载失败」，排查成本全压在手机上。这里在构建时核对。
function checkAudioReferences() {
  const sources = [];
  const quizDir = path.join(ROOT, 'quizzes');
  if (fs.existsSync(quizDir)) {
    for (const f of fs.readdirSync(quizDir)) {
      if (f.endsWith('.json')) sources.push(path.join('quizzes', f));
    }
  }
  const dataDir = path.join(ROOT, 'js', 'data');
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir)) {
      if (f.endsWith('.js')) sources.push(path.join('js', 'data', f));
    }
  }

  const refs = new Map(); // relPath -> [出题源]
  const pattern = /"(?:audioUrl|audio_url|mp3|sound)"\s*:\s*"(audio\/[^"]+)"/g;
  for (const rel of sources) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const target = m[1];
      if (!refs.has(target)) refs.set(target, []);
      if (!refs.get(target).includes(rel)) refs.get(target).push(rel);
    }
  }

  const missing = [];
  let bytes = 0;
  for (const [target, from] of refs) {
    const filepath = path.join(ROOT, target);
    if (fs.existsSync(filepath)) {
      bytes += fs.statSync(filepath).size;
    } else {
      missing.push(`${target}（被 ${from.join('、')} 引用）`);
    }
  }

  if (missing.length) {
    console.error(`❌ 题库引用了 ${missing.length} 个仓库里不存在的音频文件（App 里会提示加载失败）：`);
    for (const item of missing.slice(0, 15)) console.error('   ' + item);
    if (missing.length > 15) console.error(`   …另有 ${missing.length - 15} 个`);
    console.error('   音频必须 commit + push 到仓库（raw.githubusercontent 直接按 main 分支取），发布链路见 README「签名与发版」。');
    process.exitCode = 1;
  } else if (refs.size) {
    console.log(`音频引用核对通过：${refs.size} 个 audio/ 文件全部在仓库中（共 ${human(bytes)}，不打包、走在线下载）`);
  } else {
    console.log('音频引用核对：没有题库使用 audio/ 相对路径');
  }
}

function main() {
  checkVersions();
  checkBuiltinDrift();
  checkAudioReferences();

  // 只清 www 自己，绝不碰仓库其它目录
  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  const report = [];

  for (const f of FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) {
      console.error(`❌ 缺少入口文件：${f}`);
      process.exitCode = 1;
      continue;
    }
    fs.copyFileSync(src, path.join(OUT, f));
    report.push([f, sizeOf(src)]);
  }

  for (const d of DIRS) {
    if (DENY.has(d)) {
      console.error(`❌ ${d}/ 在禁止打包名单里，检查 DIRS 配置`);
      process.exitCode = 1;
      continue;
    }
    const src = path.join(ROOT, d);
    if (!fs.existsSync(src)) {
      console.error(`❌ 缺少资源目录：${d}/`);
      process.exitCode = 1;
      continue;
    }
    copyInto(src, path.join(OUT, d));
    report.push([d + '/', sizeOf(src)]);
  }

  // 自检：www 里不许出现被禁止的目录，也不许出现 www/www
  const leaked = [...DENY].filter(name => fs.existsSync(path.join(OUT, name)));
  if (fs.existsSync(path.join(OUT, 'www'))) leaked.push('www');
  if (leaked.length) {
    console.error('❌ 产物中混入了不该打包的路径：' + leaked.join(', '));
    process.exitCode = 1;
  }

  checkScripts();

  console.log('www/ 构建完成：');
  let total = 0;
  for (const [name, bytes] of report) {
    console.log(`  ${name.padEnd(16)} ${human(bytes)}`);
    total += bytes;
  }
  console.log(`  ${'合计'.padEnd(15)} ${human(total)}`);
  console.log('\n下一步（本机没有独立 node/npx，capacitor 用 Electron 跑）：');
  console.log('  rm -rf android/app/src/main/assets/public   # sync 只覆盖不清理，残留会进包');
  console.log('  ELECTRON_RUN_AS_NODE=1 "/Applications/Qoder CN.app/Contents/MacOS/Qoder CN" \\');
  console.log('    node_modules/@capacitor/cli/bin/capacitor sync android');
}

main();

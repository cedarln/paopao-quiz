#!/usr/bin/env node
/**
 * 题库派生工具：把「源 JSON」→「内置 js/data/<x>.js」+「在线镜像 quizzes/<name>~<key>.json」
 *
 * 用法（本机没有独立 node/npx，用 Electron 跑）：
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/Qoder CN.app/Contents/MacOS/Qoder CN" tools/merge-banks.js --dry-run
 *   ... tools/merge-banks.js --only <key>        # 只处理一个题库
 *   ... tools/merge-banks.js --force             # 允许镜像题量变小（默认拒绝）
 *
 * 为什么要改这个脚本（v1.8.0 前的体检结论）：
 * 1. 镜像文件名原来只按 `${name}~${key}.json` 拼，与仓库里既有的文件名规则不同时
 *    （例如 ms-daofa-zhengzhi.json 没有 ~ 段），跑一次就多出一个同 key 不同名的文件，
 *    用户在传送门里会看到两个同名题库，收藏与错题跟着分裂。现在按 key 找回既有文件。
 * 2. 源文件缺失或 JSON 解析失败原来只 console.warn 然后跳过，构建照样「成功」。
 *    实际后果：tmp-build/paper_zzhx.json 是 13 题的旧稿，而已上线镜像是 35 题 ——
 *    跑一次这条命令就把线上题库削掉 22 题。现在一律硬失败，且题量变小需要 --force。
 * 3. generateJS 原来用单引号逐字段手写，只输出固定几个字段：answerText 里出现真实换行
 *    就整文件 SyntaxError（内置面试题库因此从未注册过，且页面不报错），
 *    而 optionResults / audio 等字段会被静默丢掉。现在题目走 JSON 序列化 + vm 回读比对。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp-build');
const DATA_DIR = path.join(ROOT, 'js', 'data');
const QUIZZES_DIR = path.join(ROOT, 'quizzes');

// 需要派生的题库注册表
//   jsonFile     —— tmp-build/ 下的源文件（编写态）
//   fromQuiz     —— 没有源文件时，直接从 quizzes/ 里已上线的镜像文件名取内容（发布态）
//   jsFilename   —— 内置 JS 文件名；null 表示只做在线镜像、不内置
//   mergeWith    —— 再合并一个题目数组文件，合并时自动续排 id
//   overwriteQuiz—— 显式指定镜像文件名（一般不需要，脚本会按 key 找回既有文件）
const BANKS_TO_MERGE = [
  // 下面三个内置题库的源文件早就丢了，内容以已上线的镜像为准（fromQuiz）。
  // 用 fromQuiz 时 name/icon/description/category 都由镜像自带，不需要在注册表里重复写一遍。
  { fromQuiz: '综合素质（中学）~zhsz-zhongxue.json', jsKey: 'zhsz-zhongxue', jsFilename: 'zhsz-zhongxue.js' },
  { fromQuiz: '教育知识与能力（中学）~jyzn-zhongxue.json', jsKey: 'jyzn-zhongxue', jsFilename: 'jyzn-zhongxue.js' },
  { fromQuiz: '思想政治学科知识与教学能力（高中）~xk-zhengzhi.json', jsKey: 'xk-zhengzhi', jsFilename: 'xk-zhengzhi.js' },
  {
    jsonFile: 'ms_daofa.json',
    jsKey: 'ms-daofa-zhengzhi',
    jsFilename: 'ms-daofa.js',
    name: '教资面试 · 道德与法治（道法/思政）',
    icon: '🎤',
    description: '结构化问答、试讲、答辩真题风格训练',
    category: 'education',
    overwriteQuiz: 'ms-daofa-zhengzhi.json'
  },
  {
    jsonFile: 'paper_zhsz.json',
    jsKey: 'zhsz-zhongxue-paper-1',
    jsFilename: null,
    name: '综合素质（中学）模拟卷 第1回',
    icon: '📝',
    category: 'education',
    isPaper: true
  },
  {
    jsonFile: 'paper_jyzn.json',
    jsKey: 'jyzn-zhongxue-paper-1',
    jsFilename: null,
    name: '教育知识与能力（中学）模拟卷 第1回',
    icon: '📐',
    category: 'education',
    isPaper: true
  },
  {
    // 曾经指向 paper_zzhx.json（13 题旧稿），而线上镜像是 35 题完整版 —— 已换成完整稿
    jsonFile: 'paper_zzhx_complete.json',
    jsKey: 'xk-zhengzhi-paper-1',
    jsFilename: null,
    name: '思想政治学科知识与教学能力 模拟卷 第1回',
    icon: '🏛️',
    category: 'education',
    isPaper: true
  },
  {
    jsonFile: 'mbti-16personalities.json',
    jsKey: 'mbti-16personalities',
    jsFilename: null,
    name: 'MBTI16型人格测试',
    icon: '🧠',
    category: 'assessment',
    overwriteQuiz: 'MBTI16型人格测试~mbti-16personalities.json'
  }
];

function parseArgs(argv) {
  const opts = { only: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--only') { opts.only = argv[++i]; if (!opts.only) fail('用法：--only <题库key>'); }
    else if (a.startsWith('--only=')) opts.only = a.slice(7);
    else fail('未知参数：' + a);
  }
  return opts;
}

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

function readJSON(file) {
  if (!fs.existsSync(file)) return { error: `文件不存在：${path.relative(ROOT, file)}` };
  try {
    return { data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: `JSON 解析失败：${path.relative(ROOT, file)} —— ${e.message}` };
  }
}

function loadSource(config) {
  if (config.fromQuiz) {
    const r = readJSON(path.join(QUIZZES_DIR, config.fromQuiz));
    if (r.error) return r;
    return { data: r.data, origin: `quizzes/${config.fromQuiz}` };
  }
  const r = readJSON(path.join(TMP, config.jsonFile));
  if (r.error) return r;
  return { data: r.data, origin: `tmp-build/${config.jsonFile}` };
}

// 内置 JS 与在线镜像共用的「题库骨架」：除题目外只带 App 认识的顶层字段
// （addBank 只透传 name/icon/description/category/questions/exam/type/resultMode/results/dimensions，
//   多写的顶层字段会被 App 丢弃，所以这里也不写进去，免得看起来生效其实没生效）
function bankSkeleton(bankData) {
  const out = {
    name: bankData.name,
    icon: bankData.icon || '📚',
    description: bankData.description || '',
    category: bankData.category || 'custom',
    questions: bankData.questions
  };
  if (bankData.exam && typeof bankData.exam === 'object') out.exam = bankData.exam;
  if (bankData.type === 'assessment') {
    out.type = 'assessment';
    out.resultMode = bankData.resultMode || 'combine';
    out.dimensions = bankData.dimensions || [];
    out.results = bankData.results || [];
  }
  if (typeof bankData.audioBase === 'string' && bankData.audioBase) out.audioBase = bankData.audioBase;
  return out;
}

function generateJS(key, bankData) {
  const skeleton = bankSkeleton(bankData);
  return [
    `// ${skeleton.name} —— 内置题库，由 tools/merge-banks.js 生成，不要手改`,
    `// 题目字段整份 JSON 序列化：早先手写单引号时，answerText 里的真实换行`,
    `// 会让整个脚本 SyntaxError，题库静默消失（页面不报错，只是首页少一张卡）`,
    `window.QUIZ_DATA = window.QUIZ_DATA || {};`,
    `window.QUIZ_DATA[${JSON.stringify(key)}] = ` + JSON.stringify(skeleton, null, 2) + `;`,
    ''
  ].join('\n');
}

// 按 key 找回既有镜像文件名，避免「同 key 不同文件名」把题库劈成两半
function resolveMirrorName(config, bankData) {
  if (config.overwriteQuiz) return config.overwriteQuiz;
  const entries = fs.existsSync(QUIZZES_DIR) ? fs.readdirSync(QUIZZES_DIR) : [];
  const byTilde = entries.filter(f => f.endsWith('.json') && f.slice(0, -5).split('~').pop() === config.jsKey);
  if (byTilde.length > 1) fail(`quizzes/ 里有 ${byTilde.length} 个文件的 key 段都是 ${config.jsKey}，先人工合并：\n   ` + byTilde.join('\n   '));
  if (byTilde.length === 1) return byTilde[0];
  const bare = `${config.jsKey}.json`;
  if (entries.includes(bare)) return bare;
  return `${bankData.name}~${config.jsKey}.json`;
}

function writeFile(target, content, label, dryRun) {
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (before === content) { console.log(`  = ${label} 无变化`); return false; }
  if (dryRun) { console.log(`  ${before === null ? '＋' : '~'} ${label} 将${before === null ? '新建' : '改写'}（dry-run 未落盘）`); return true; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  console.log(`  ${before === null ? '＋' : '~'} ${label}`);
  return true;
}

// 镜像按「解析后的内容」比较，不比字节：既有文件里有的是紧凑缩进写的，
// 字节比就会认定有变化并整份重写 —— 传送门按文件 sha 判状态，
// 白白让用户看到一排「有更新」。
function existedContentIsSame(target, bankData) {
  if (!fs.existsSync(target)) return false;
  const cur = readJSON(target);
  if (cur.error) return false;
  return JSON.stringify(cur.data) === JSON.stringify(bankData);
}

// 生成完立刻回读验证：能解析、题量一致、题目内容一字不差
function verifyGenerated(jsPath, key, bankData) {
  const win = { QUIZ_DATA: undefined };
  const sandbox = { window: win };
  sandbox.globalThis = sandbox;
  new vm.Script(fs.readFileSync(jsPath, 'utf8'), { filename: path.relative(ROOT, jsPath) }).runInNewContext(sandbox);
  const made = win.QUIZ_DATA && win.QUIZ_DATA[key];
  if (!made) throw new Error('回读后 window.QUIZ_DATA 里没有这个 key');
  if (made.questions.length !== bankData.questions.length) {
    throw new Error(`题量不符：源 ${bankData.questions.length}，生成 ${made.questions.length}`);
  }
  for (let i = 0; i < bankData.questions.length; i++) {
    if (JSON.stringify(made.questions[i]) !== JSON.stringify(bankData.questions[i])) {
      throw new Error(`第 ${i + 1} 题内容与源不一致（字段丢失或改写）`);
    }
  }
  const srcFields = new Set(bankData.questions.flatMap(q => Object.keys(q || {})));
  const outFields = new Set(made.questions.flatMap(q => Object.keys(q || {})));
  const lost = [...srcFields].filter(f => !outFields.has(f));
  if (lost.length) throw new Error('题目字段被丢弃：' + lost.join(', '));
  return made;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const problems = [];
  let changed = 0;

  const targets = opts.only
    ? BANKS_TO_MERGE.filter(c => c.jsKey === opts.only || c.jsonFile === opts.only)
    : BANKS_TO_MERGE;
  if (opts.only && !targets.length) fail(`注册表里没有 key/源文件为 ${opts.only} 的题库`);
  console.log(`${opts.dryRun ? '🔍 DRY-RUN（不写盘）' : '🔄 派生题库'}：${targets.length} 个注册项\n`);

  for (const config of targets) {
    console.log(`处理: ${config.jsKey}  ← ${config.fromQuiz ? 'quizzes/' + config.fromQuiz : 'tmp-build/' + config.jsonFile}`);

    const loaded = loadSource(config);
    if (loaded.error) { problems.push(`${config.jsKey}：${loaded.error}`); console.log('  ❌ ' + loaded.error); continue; }
    const bankData = loaded.data;

    if (!Array.isArray(bankData.questions) || !bankData.questions.length) {
      problems.push(`${config.jsKey}：源文件没有 questions 数组或为空`); console.log('  ❌ 无题目'); continue;
    }

    if (config.mergeWith) {
      const extra = readJSON(path.join(TMP, config.mergeWith));
      if (extra.error) { problems.push(`${config.jsKey}：合并源 ${config.mergeWith} —— ${extra.error}`); console.log('  ❌ ' + extra.error); continue; }
      if (!Array.isArray(extra.data)) { problems.push(`${config.jsKey}：${config.mergeWith} 顶层不是数组，无法合并`); continue; }
      const startId = bankData.questions.length + 1;
      extra.data.forEach((q, idx) => { q.id = startId + idx; bankData.questions.push(q); });
      console.log(`  合并 ${extra.data.length} 题，总计 ${bankData.questions.length}`);
    }

    if (!bankData.key) bankData.key = config.jsKey;
    if (bankData.key !== config.jsKey) {
      problems.push(`${config.jsKey}：源里的 key 是 ${bankData.key}，与注册表不一致（换 key 会让用户收藏与错题脱钩）`);
      console.log('  ❌ ' + problems[problems.length - 1]); continue;
    }
    if (!bankData.name) bankData.name = config.name;
    if (!bankData.icon) bankData.icon = config.icon;
    if (!bankData.description) bankData.description = config.description || '';
    if (!bankData.category) bankData.category = config.category;

    // ---- 内置 JS ----
    if (config.jsFilename) {
      const jsPath = path.join(DATA_DIR, config.jsFilename);
      const content = generateJS(config.jsKey, bankData);
      if (writeFile(jsPath, content, `内置 JS js/data/${config.jsFilename}`, opts.dryRun)) changed++;
      if (!opts.dryRun) {
        try { verifyGenerated(jsPath, config.jsKey, bankData); }
        catch (e) { problems.push(`${config.jsKey}：${e.message}`); console.log('  ❌ 回读校验失败 ' + e.message); continue; }
      } else {
        console.log('  （dry-run 跳过内置 JS 的回读校验）');
      }
    }

    // ---- 在线镜像 ----
    const mirrorName = resolveMirrorName(config, bankData);
    const mirrorPath = path.join(QUIZZES_DIR, mirrorName);
    if (fs.existsSync(mirrorPath)) {
      const cur = readJSON(mirrorPath);
      if (cur.error) { problems.push(`${config.jsKey}：既有镜像 ${mirrorName} —— ${cur.error}`); console.log('  ❌ ' + problems[problems.length - 1]); continue; }
      const before = (cur.data.questions || []).length;
      const after = bankData.questions.length;
      if (after < before && !opts.force) {
        problems.push(`${config.jsKey}：题量将从 ${before} 缩到 ${after}，疑似源文件是旧稿（确认无误再加 --force）`);
        console.log('  ❌ ' + problems[problems.length - 1]); continue;
      }
      if (after < before) console.log(`  ⚠️ 已用 --force 放行题量收缩：${before} → ${after}`);
    }
    const mirrorContent = JSON.stringify(bankData, null, 2);
    if (existedContentIsSame(mirrorPath, bankData)) {
      console.log(`  题目 ${bankData.questions.length} 道，镜像 quizzes/${mirrorName} 内容一致（不重写，避免 sha 变化让用户侧误报「有更新」）`);
    } else {
      writeFile(mirrorPath, mirrorContent, `在线镜像 quizzes/${mirrorName}${fs.existsSync(mirrorPath) ? '' : '（新文件）'}`, opts.dryRun);
      changed++;
      console.log(`  题目 ${bankData.questions.length} 道，镜像 ${mirrorName}`);
    }
  }

  if (opts.dryRun && changed) console.log(`\n🔍 dry-run 结论：有 ${changed} 处内容会变化，去掉 --dry-run 才会落盘`);
  if (problems.length) {
    console.error(`\n❌ ${problems.length} 项未处理：`);
    problems.forEach(p => console.error('   ' + p));
    console.error('\n本脚本不会静默跳过：注册表与源文件必须一致。单个题库重跑用 --only <key>。');
    process.exit(1);
  }
  console.log(`\n✅ 全部注册项处理完毕（变更 ${changed} 处${opts.dryRun ? '，dry-run 未落盘' : ''}）`);
  console.log('内置 JS 变更后记得跑 tools/build-www.js（它会核对 index.html 的脚本引用与语法）。');
}

main();

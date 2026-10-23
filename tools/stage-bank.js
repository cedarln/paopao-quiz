#!/usr/bin/env node
/**
 * stage-bank.js —— 在 quizzes/（对用户可见）与 quizzes-draft/（暂存、检测不到）之间搬题库
 *
 * 「传送门」只列 GitHub 仓库的 quizzes/ 目录，所以把文件移到 quizzes-draft/
 * 是唯一对已安装旧版本也立刻生效的下线手段。
 *
 *   node tools/stage-bank.js status
 *   node tools/stage-bank.js hide  mbti-16personalities
 *   node tools/stage-bank.js show  mbti-16personalities
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE = path.join(ROOT, 'quizzes');
const DRAFT = path.join(ROOT, 'quizzes-draft');

// 只匹配 .json，README.md 永远留在原地
function banks(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'));
}

// 文件名约定「展示名~key.json」；没有 ~ 时整个主干就是 key
function keyOf(file) {
  const stem = file.replace(/\.json$/, '');
  return stem.includes('~') ? stem.split('~').pop() : stem;
}

function findMatch(dir, pattern) {
  const p = pattern.toLowerCase();
  return banks(dir).filter(f => keyOf(f).toLowerCase() === p || f.toLowerCase().includes(p));
}

function needGitMove() {
  try { fs.accessSync(path.join(ROOT, '.git')); return true; }
  catch (e) { return false; }
}

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) throw new Error(`目标已存在同名文件：${path.relative(ROOT, to)}`);
  fs.renameSync(from, to);
}

function status() {
  const live = banks(LIVE), draft = banks(DRAFT);
  console.log(`\nquizzes/ —— 用户可见（${live.length} 个）`);
  live.forEach(f => console.log('  · ' + f));
  console.log(`\nquizzes-draft/ —— 暂存，App 检测不到（${draft.length} 个）`);
  draft.forEach(f => console.log('  · ' + f));
  if (!draft.length) console.log('  （空）');
  console.log('');
}

function main() {
  const [cmd, pattern] = process.argv.slice(2);

  if (!cmd || cmd === 'status') return status();

  if (cmd !== 'hide' && cmd !== 'show') {
    console.error(`未知命令：${cmd}\n用法：node tools/stage-bank.js <status|hide|show> [key]`);
    process.exit(1);
  }
  if (!pattern) {
    console.error('请给出题库 key 或文件名片段，例如：node tools/stage-bank.js hide mbti-16personalities');
    process.exit(1);
  }

  const fromDir = cmd === 'hide' ? LIVE : DRAFT;
  const toDir = cmd === 'hide' ? DRAFT : LIVE;
  const matches = findMatch(fromDir, pattern);

  if (!matches.length) {
    console.error(`❌ ${path.basename(fromDir)}/ 里没有匹配「${pattern}」的题库`);
    const elsewhere = findMatch(toDir, pattern);
    if (elsewhere.length) console.error(`   它已经在 ${path.basename(toDir)}/ 了：${elsewhere.join(', ')}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`❌「${pattern}」匹配到 ${matches.length} 个，请说得更具体：\n   ` + matches.join('\n   '));
    process.exit(1);
  }

  const file = matches[0];
  const absFrom = path.join(fromDir, file);
  const absTo = path.join(toDir, file);

  move(absFrom, absTo);

  // 交给 git 认成 rename，避免历史断裂；未跟踪文件 rename 本身就是移动，不用管
  if (needGitMove()) {
    const { execSync } = require('child_process');
    try {
      execSync(`git rm --cached --ignore-unmatch -- "${path.relative(ROOT, absFrom)}" >/dev/null 2>&1`);
      execSync(`git add -- "${path.relative(ROOT, absTo)}" "${path.relative(ROOT, absFrom)}"`);
    } catch (e) { /* 未跟踪时正常失败，忽略 */ }
  }

  console.log(`${cmd === 'hide' ? '🔒 已下线' : '🔓 已开放'}：${file}`);
  console.log(`   ${path.basename(fromDir)}/ → ${path.basename(toDir)}/`);
  console.log('   还没提交推送。要生效记得 git commit + push。');
}

main();

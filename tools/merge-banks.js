#!/usr/bin/env node
/**
 * 将 tmp-build/ 下的题库 JSON 转换为内置 JS + quizzes/ 镜像
 * 用法：ELECTRON_RUN_AS_NODE=1 "/Applications/Qoder CN.app/Contents/MacOS/Qoder CN" tools/merge-banks.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp-build');
const DATA_DIR = path.join(ROOT, 'js', 'data');
const QUIZZES_DIR = path.join(ROOT, 'quizzes');

// 需要合并的题库配置
const BANKS_TO_MERGE = [
  // { jsonFile, jsKey, jsFilename, isPaper }
  {
    jsonFile: 'zzx_choice.json',
    jsKey: 'xk-zhengzhi',
    jsFilename: 'xk-zhengzhi.js',
    name: '思想政治学科知识与教学能力（高中）',
    icon: '🏛️',
    description: '学科知识、课程与教学论、教学评价与案例（含主观题）',
    category: 'education',
    mergeWith: 'zzx_subjective.json' // 合并主观题数组
  },
  {
    jsonFile: 'ms_daofa.json',
    jsKey: 'ms-daofa-zhengzhi',
    jsFilename: 'ms-daofa.js',
    name: '教资面试 · 道德与法治（道法/思政）',
    icon: '🎤',
    description: '结构化问答、试讲、答辩真题风格训练',
    category: 'education'
  },
  {
    jsonFile: 'paper_zhsz.json',
    jsKey: 'zhsz-zhongxue-paper-1',
    jsFilename: null, // 只放 quizzes，不内置
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
    jsonFile: 'paper_zzhx.json',
    jsKey: 'xk-zhengzhi-paper-1',
    jsFilename: null,
    name: '思想政治学科知识与教学能力 模拟卷 第1回',
    icon: '🏛️',
    category: 'education',
    isPaper: true
  },
  {
    jsonFile: 'mbti_expanded.json',
    jsKey: 'mbti-16personalities',
    jsFilename: null, // 覆盖 quizzes 里的现有文件
    name: 'MBTI16型人格测试',
    icon: '🧠',
    category: 'assessment',
    overwriteQuiz: 'MBTI16型人格测试~mbti-16personalities.json'
  }
];

function loadJSON(filename) {
  const filepath = path.join(TMP, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`⚠️ 文件不存在: ${filepath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`❌ JSON 解析失败: ${filepath} - ${e.message}`);
    return null;
  }
}

function escapeJsString(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}

function generateJS(key, bankData) {
  const lines = [];
  lines.push(`// ${bankData.name} 题库`);
  lines.push(`window.QUIZ_DATA = window.QUIZ_DATA || {};`);
  lines.push(`window.QUIZ_DATA['${key}'] = {`);
  lines.push(`  name: '${escapeJsString(bankData.name)}',`);
  lines.push(`  icon: '${bankData.icon || '📚'}',`);
  lines.push(`  description: '${escapeJsString(bankData.description || '')}',`);
  if (bankData.category) {
    lines.push(`  category: '${bankData.category}',`);
  }
  if (bankData.type === 'assessment') {
    lines.push(`  type: 'assessment',`);
    lines.push(`  resultMode: '${bankData.resultMode || 'combine'}',`);
    lines.push(`  dimensions: ${JSON.stringify(bankData.dimensions)},`);
    lines.push(`  results: ${JSON.stringify(bankData.results)},`);
  }
  if (bankData.exam) {
    lines.push(`  exam: ${JSON.stringify(bankData.exam)},`);
  }
  lines.push(`  questions: [`);
  
  for (let i = 0; i < bankData.questions.length; i++) {
    const q = bankData.questions[i];
    const fields = [];
    fields.push(`    id: ${q.id}`);
    if (q.category) fields.push(`category: '${escapeJsString(q.category)}'`);
    fields.push(`question: '${escapeJsString(q.question)}'`);
    
    if (isSubjective(q)) {
      fields.push(`subjective: true`);
      fields.push(`options: []`);
      if (q.answerText) fields.push(`answerText: '${escapeJsString(q.answerText)}'`);
      if (q.explanation) fields.push(`explanation: '${escapeJsString(q.explanation)}'`);
    } else {
      fields.push(`options: ${JSON.stringify(q.options)}`);
      fields.push(`answer: ${q.answer}`);
      if (q.explanation) fields.push(`explanation: '${escapeJsString(q.explanation)}'`);
      if (q.audioUrl) fields.push(`audioUrl: '${escapeJsString(q.audioUrl)}'`);
    }
    
    lines.push(`    { ${fields.join(', ')} }`);
  }
  
  lines.push(`  ]`);
  lines.push(`};`);
  return lines.join('\n');
}

function isSubjective(q) {
  return q.subjective === true || ((!Array.isArray(q.options) || q.options.length === 0) && (q.answerText || q.explanation));
}

function main() {
  console.log('🔄 开始合并题库...\n');
  
  let successCount = 0;
  let skipCount = 0;
  
  for (const config of BANKS_TO_MERGE) {
    console.log(`处理: ${config.jsonFile}`);
    
    let bankData = loadJSON(config.jsonFile);
    if (!bankData) {
      skipCount++;
      continue;
    }
    
    // 如果需要合并另一个文件（如主观题数组）
    if (config.mergeWith) {
      const extraData = loadJSON(config.mergeWith);
      if (extraData && Array.isArray(extraData)) {
        // 重新分配 id
        const startId = bankData.questions.length + 1;
        extraData.forEach((q, idx) => {
          q.id = startId + idx;
          bankData.questions.push(q);
        });
        console.log(`  ✅ 合并了 ${extraData.length} 道主观题，总题数: ${bankData.questions.length}`);
      }
    }
    
    // 确保顶层字段完整
    if (!bankData.key) bankData.key = config.jsKey;
    if (!bankData.name) bankData.name = config.name;
    if (!bankData.icon) bankData.icon = config.icon;
    if (!bankData.description) bankData.description = config.description || '';
    if (!bankData.category) bankData.category = config.category;
    
    // 生成内置 JS（如果有 jsFilename）
    if (config.jsFilename) {
      const jsContent = generateJS(config.jsKey, bankData);
      const jsPath = path.join(DATA_DIR, config.jsFilename);
      fs.writeFileSync(jsPath, jsContent, 'utf8');
      console.log(`  📄 写入内置 JS: ${config.jsFilename} (${bankData.questions.length} 题)`);
    }
    
    // 生成 quizzes/ JSON 镜像
    let quizFilename;
    if (config.overwriteQuiz) {
      quizFilename = config.overwriteQuiz;
    } else {
      quizFilename = `${bankData.name}~${config.jsKey}.json`;
    }
    const quizPath = path.join(QUIZZES_DIR, quizFilename);
    fs.writeFileSync(quizPath, JSON.stringify(bankData, null, 2), 'utf8');
    console.log(`  📦 写入在线题库: ${quizFilename}`);
    
    successCount++;
  }
  
  console.log(`\n✅ 完成！成功: ${successCount}, 跳过: ${skipCount}`);
}

main();

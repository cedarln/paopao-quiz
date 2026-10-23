const fs = require('fs');
const path = require('path');

function scan(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    const full = path.join(dir, f);
    let d;
    try { d = JSON.parse(fs.readFileSync(full, 'utf8')); }
    catch (e) { return { disp: f, type: '解析失败', n: 0, subj: 0, asr: 0, kb: 0, err: e.message }; }
    const qs = d.questions || [];
    const subj = qs.filter(q => q.subjective).length;
    const asr = qs.filter(q => q.audioUrl || q.audio).length;
    let t;
    if (d.type === 'assessment') t = '测评';
    else if (d.exam) t = '套卷';
    else if (subj && subj === qs.length) t = '纯主观';
    else if (subj) t = '客观+主观';
    else t = '纯客观';
    return {
      disp: f.replace(/\.json$/, '').split('~')[0],
      key: d.key || '(无key)',
      type: t, n: qs.length, subj, asr,
      kb: +(fs.statSync(full).size / 1024).toFixed(0)
    };
  });
}

const rows = scan(process.argv[2] || 'quizzes').sort((a, b) => b.kb - a.kb);
let totalKb = 0;
console.log('展示名'.padEnd(26) + 'key'.padEnd(28) + '类型'.padEnd(10) + '题数'.padStart(5) + '主观'.padStart(5) + '音频'.padStart(5) + '   体积');
console.log('-'.repeat(110));
for (const r of rows) {
  totalKb += r.kb;
  console.log(
    r.disp.padEnd(26) + String(r.key).padEnd(28) + r.type.padEnd(10) +
    String(r.n).padStart(5) + String(r.subj).padStart(5) + String(r.asr).padStart(5) + '  ' + (r.kb + 'K')
  );
}
console.log('-'.repeat(110));
console.log(`合计 ${rows.length} 个文件，${(totalKb / 1024).toFixed(2)} MB`);

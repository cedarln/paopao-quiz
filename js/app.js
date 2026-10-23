/**
 * 泡泡题库 - 主应用逻辑
 */
(function () {
  'use strict';

  // ===== 状态管理 =====
  const state = {
    selectedSubject: null,
    qty: 10,
    mode: 'sequential',
    questions: [],
    currentIndex: 0,
    answers: [], // { questionId, selected, correct, isRight }
    stats: {
      totalAnswered: 0,
      totalCorrect: 0,
      streakDays: 1,
      lastDate: null
    },
    importedKeys: {}, // 记录哪些 key 是用户导入的
    pendingImport: null, // 等待用户选择覆盖/追加的导入数据
    recycleBin: {}, // 回收站：key -> bankData（可恢复）
    hiddenKeys: {}, // 已彻底隐藏的题库 key（不可恢复，内置题库专用）
    wrongBook: {}, // 错题本：key -> { subjectKey, id, question, options, answer, explanation, category, wrongCount, lastWrongAt }
    isExam: false, // 是否为模拟考试模式
    examTimeLimit: 0, // 考试时长（秒），0 表示不限时
    examTimeLeft: 0, // 剩余秒数
    examTimer: null, // 倒计时定时器
    paperMode: false, // 是否为套卷考试模式（按卷面分节计时）
    paperPracticeMode: false, // 是否为套卷练习模式（整卷顺序、即时解析）
    paperSections: [], // 套卷分区：{ name, count, minutes, start, end }
    paperSectionIndex: 0, // 当前分区下标
    paperSectionTimeLeft: 0, // 当前分区剩余秒数
    paperPendingSection: null, // 分节弹窗中即将进入的分区下标
    reviewMode: false, // 当前是否为错题再练模式
    activeCategory: null, // 当前选中的题目分类筛选
    combo: 0, // 当前连击数
    xp: 0, // 经验值
    level: 1, // 等级
    streakDays: 1, // 连续打卡天数
    streakLastDate: null, // 上次打卡日期
    achievements: {}, // 已解锁成就：id -> unlockedAt
    favorites: {}, // 收藏题目：subjectKey__id -> { subjectKey, id, question, options, answer, explanation, category }
    studyLog: {}, // 学习日志：date -> count
    answeredSubjects: {} // 已答过的科目：key -> true
  };

  const OPTION_LABELS = ['A', 'B', 'C', 'D'];
  const IMPORTED_STORAGE_KEY = 'quiz-imported-banks';
  const RECYCLE_BIN_STORAGE = 'quiz-recycle-bin';
  const HIDDEN_KEYS_STORAGE = 'quiz-hidden-keys';
  const WRONG_BOOK_STORAGE = 'quiz-wrong-book';
  const XP_STORAGE = 'quiz-xp-level';
  const STREAK_STORAGE = 'quiz-streak';
  const ACHIEVEMENTS_STORAGE = 'quiz-achievements';
  const FAVORITES_STORAGE = 'quiz-favorites';
  const STUDY_LOG_STORAGE = 'quiz-study-log';

  // ===== IndexedDB 题库存储 =====
  // 导入的题库（尤其是几千题的英语词库）体积可达数 MB，localStorage 配额只有约 5MB，
  // 改用 IndexedDB 存储后基本不受限。旧版本存在 localStorage 里的数据会在启动时自动迁移。
  const IDB_NAME = 'quiz-storage';
  const IDB_STORE = 'kv';
  const IDB_IMPORTED_KEY = 'imported-banks';
  // 听力音频缓存库（v1.8.0 起音频不再随 APK 打包，见下方「在线音频 + 本地缓存」）
  const IDB_AUDIO_STORE = 'audio';

  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB 不可用')); return; }
      const req = indexedDB.open(IDB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
        // 从 v1 升上来时这里也会执行一次；已存在时跳过，不动老数据。
        if (!db.objectStoreNames.contains(IDB_AUDIO_STORE)) {
          const store = db.createObjectStore(IDB_AUDIO_STORE, { keyPath: 'cacheKey' });
          store.createIndex('bankKey', 'bankKey', { unique: false });
          store.createIndex('lastUsed', 'lastUsed', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(key) {
    return openIdb().then(db => new Promise((resolve, reject) => {
      const rq = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    }));
  }

  function idbSet(key, val) {
    return openIdb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // ===== 成就系统 =====
  // type: 答题/连击/等级/打卡/综合  | progress: { current, target } 或 null（无进度条）
  const ACHIEVEMENTS = [
    { id: 'first-answer', icon: '🌱', name: '初出茅庐', desc: '完成第一道题', cat: '答题', progress: () => Math.min(1, state.stats.totalAnswered || 0) + '/' + 1 },
    { id: 'correct-10', icon: '✅', name: '小试牛刀', desc: '累计答对 10 题', cat: '答题', progress: () => Math.min(10, state.stats.totalCorrect || 0) + '/10' },
    { id: 'correct-50', icon: '🎯', name: '百步穿杨', desc: '累计答对 50 题', cat: '答题', progress: () => Math.min(50, state.stats.totalCorrect || 0) + '/50' },
    { id: 'correct-100', icon: '🏹', name: '百发百中', desc: '累计答对 100 题', cat: '答题', progress: () => Math.min(100, state.stats.totalCorrect || 0) + '/100' },
    { id: 'correct-200', icon: '💎', name: '题海无涯', desc: '累计答对 200 题', cat: '答题', progress: () => Math.min(200, state.stats.totalCorrect || 0) + '/200' },
    { id: 'combo-5', icon: '⚡', name: '连击达人', desc: '达成 5 连击', cat: '连击', progress: () => Math.min(5, state.combo) + '/5' },
    { id: 'combo-10', icon: '🔥', name: '火焰连击', desc: '达成 10 连击', cat: '连击', progress: () => Math.min(10, state.combo) + '/10' },
    { id: 'combo-15', icon: '🌋', name: '连击大师', desc: '达成 15 连击', cat: '连击', progress: () => Math.min(15, state.combo) + '/15' },
    { id: 'level-5', icon: '⭐', name: '等级突破', desc: '达到 Lv.5', cat: '等级', progress: () => Math.min(5, state.level) + '/5' },
    { id: 'level-10', icon: '🌟', name: '学霸之路', desc: '达到 Lv.10', cat: '等级', progress: () => Math.min(10, state.level) + '/10' },
    { id: 'level-15', icon: '👑', name: '学神降临', desc: '达到 Lv.15', cat: '等级', progress: () => Math.min(15, state.level) + '/15' },
    { id: 'streak-3', icon: '📅', name: '三日坚持', desc: '连续打卡 3 天', cat: '打卡', progress: () => Math.min(3, state.streakDays) + '/3' },
    { id: 'streak-7', icon: '🔥', name: '一周不辍', desc: '连续打卡 7 天', cat: '打卡', progress: () => Math.min(7, state.streakDays) + '/7' },
    { id: 'streak-30', icon: '🏆', name: '坚持一月', desc: '连续打卡 30 天', cat: '打卡', progress: () => Math.min(30, state.streakDays) + '/30' },
    { id: 'first-exam', icon: '📝', name: '初次模考', desc: '完成一次模拟考试', cat: '综合', progress: null },
    { id: 'all-subjects', icon: '📚', name: '博览群书', desc: '每个科目都刷过题', cat: '综合', progress: () => Math.min(Object.keys(window.QUIZ_DATA || {}).length, Object.keys(state.answeredSubjects || {}).length) + '/' + Object.keys(window.QUIZ_DATA || {}).length },
    { id: 'import-bank', icon: '📥', name: '海纳百川', desc: '导入一个自定义题库', cat: '综合', progress: () => Math.min(1, Object.keys(state.importedKeys || {}).length) + '/1' },
    { id: 'favorites-5', icon: '⭐', name: '收藏家', desc: '收藏 5 道题目', cat: '综合', progress: () => Math.min(5, Object.keys(state.favorites || {}).length) + '/5' }
  ];

  function loadAchievements() {
    const saved = localStorage.getItem(ACHIEVEMENTS_STORAGE);
    if (saved) { try { state.achievements = JSON.parse(saved); } catch (e) {} }
  }
  function saveAchievements() {
    localStorage.setItem(ACHIEVEMENTS_STORAGE, JSON.stringify(state.achievements));
  }
  function unlockAchievement(id) {
    if (state.achievements[id]) return false;
    state.achievements[id] = Date.now();
    saveAchievements();
    const ach = ACHIEVEMENTS.find(a => a.id === id);
    if (ach) showAchievementToast(ach);
    return true;
  }
  function showAchievementToast(ach) {
    const el = document.createElement('div');
    el.className = 'achievement-toast';
    el.innerHTML = `<div class="ach-icon">${ach.icon}</div><div class="ach-text"><div class="ach-label">🏆 成就解锁</div><div class="ach-name">${ach.name}</div><div class="ach-desc">${ach.desc}</div></div>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 500); }, 3000);
  }
  function checkAchievements() {
    const correct = state.stats.totalCorrect || 0;
    if (correct >= 1) unlockAchievement('first-answer');
    if (correct >= 10) unlockAchievement('correct-10');
    if (correct >= 50) unlockAchievement('correct-50');
    if (correct >= 100) unlockAchievement('correct-100');
    if (correct >= 200) unlockAchievement('correct-200');
    if (state.combo >= 5) unlockAchievement('combo-5');
    if (state.combo >= 10) unlockAchievement('combo-10');
    if (state.combo >= 15) unlockAchievement('combo-15');
    if (state.level >= 5) unlockAchievement('level-5');
    if (state.level >= 10) unlockAchievement('level-10');
    if (state.level >= 15) unlockAchievement('level-15');
    if (state.streakDays >= 3) unlockAchievement('streak-3');
    if (state.streakDays >= 7) unlockAchievement('streak-7');
    if (state.streakDays >= 30) unlockAchievement('streak-30');
    if (state.answeredSubjects && Object.keys(state.answeredSubjects).length >= Object.keys(window.QUIZ_DATA || {}).length) {
      unlockAchievement('all-subjects');
    }
    if (Object.keys(state.importedKeys || {}).length >= 1) unlockAchievement('import-bank');
    if (Object.keys(state.favorites || {}).length >= 5) unlockAchievement('favorites-5');
  }

  // ===== 学习日志 =====
  // 本地日期字符串（YYYY-MM-DD）。不能用 toISOString()：它按 UTC 取日期，
  // 北京时间（UTC+8）0~8 点会落到前一天，导致学习日历色块整体错位一天。
  function localDateStr(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function loadStudyLog() {
    const saved = localStorage.getItem(STUDY_LOG_STORAGE);
    if (saved) { try { state.studyLog = JSON.parse(saved); } catch (e) {} }
  }
  function saveStudyLog() {
    localStorage.setItem(STUDY_LOG_STORAGE, JSON.stringify(state.studyLog));
  }
  function logStudy() {
    const today = localDateStr(new Date());
    state.studyLog[today] = (state.studyLog[today] || 0) + 1;
    saveStudyLog();
  }

  // ===== 收藏夹 =====
  function loadFavorites() {
    const saved = localStorage.getItem(FAVORITES_STORAGE);
    if (saved) { try { state.favorites = JSON.parse(saved); } catch (e) {} }
  }
  function saveFavorites() {
    localStorage.setItem(FAVORITES_STORAGE, JSON.stringify(state.favorites));
  }
  function toggleFavorite(q) {
    const key = `${state.selectedSubject}__${q.id}`;
    if (state.favorites[key]) {
      delete state.favorites[key];
    } else {
      state.favorites[key] = { subjectKey: state.selectedSubject, id: q.id, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation, category: q.category, ...pickExtFields(q) };
    }
    saveFavorites();
    return !state.favorites[key] ? false : true;
  }
  function isFavorite(q) {
    return !!state.favorites[`${state.selectedSubject}__${q.id}`];
  }

  // 收藏/错题本需要额外保留的题目字段（否则听力、测评等字段会丢）
  function pickExtFields(q) {
    const out = {};
    if (!q) return out;
    [
      'audio', 'audioText', 'audio_text', 'audioUrl', 'audio_url',
      'audio_script', 'mp3', 'sound', 'listening', 'speech', 'tts',
      'optionResults'
    ].forEach(key => {
      if (q[key] !== undefined && q[key] !== null && q[key] !== '') out[key] = q[key];
    });
    return out;
  }

  // ===== 在线音频 + 本地缓存（v1.8.0）=====
  // 旧做法：听力 m4a 随 APK 打包进 audio/，题目写相对路径，由 WebView 直接读 assets。
  // 代价是所有人都为 3 MB 听力付包体，做题多的题库越多包越大，且发版必须重装。
  // 新做法：
  //   1. 音频放在仓库 audio/ 下，通过 raw.githubusercontent.com 取（与 quizzes/ 同一套发布链路）；
  //   2. 第一次播放（或开始含听力的考试前）下载到 IndexedDB 的 audio 对象库，之后离线直接播；
  //   3. 题库被彻底删除 / 清空回收站时，按 bankKey 连带删掉它已下载的音频；
  //   4. 缓存超出预算按 lastUsed 逐出，取不到音频时回落到题目原文走 TTS，再不行才提示。
  //
  // 题库 JSON 侧的写法（优先级从高到低）：
  //   q.audioUrl 绝对 URL            → 用它（第三方服务器托管音频）
  //   q.audioUrl 形如 audio/<key>/x.m4a → 拼到仓库 raw 前缀（已上线的 N5 题库与用户本地已导入的副本都是这个格式，无需改文件）
  //   bank.audioBase + q.audioUrl    → 拼到题库自己声明的前缀
  //   bank.audioBase + q.id          → 题库只声明前缀和题号范围，逐题按 <id>.<audioExt> 拼（新题库推荐，JSON 里不用写 66 个字段）
  const AUDIO_CACHE_BUDGET = 80 * 1024 * 1024; // 80 MB，约 1300 段听力
  const RAW_REPO_BASE = () => `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/`;

  function bankKeyOf(q) {
    if (q && typeof q.subjectKey === 'string' && window.QUIZ_DATA && window.QUIZ_DATA[q.subjectKey]) {
      return q.subjectKey;
    }
    if (state.selectedSubject && window.QUIZ_DATA && window.QUIZ_DATA[state.selectedSubject]) {
      return state.selectedSubject;
    }
    return (q && typeof q.subjectKey === 'string') ? q.subjectKey : (state.selectedSubject || '');
  }

  function joinUrl(base, path) {
    const b = String(base).trim();
    const p = String(path).replace(/^\/+/, '');
    if (!p) return b;
    return b.endsWith('/') ? b + p : b + '/' + p;
  }

  // 把题目里写明的（或按题库规则推出来的）音频地址解析成可 fetch 的绝对 URL
  function resolveAudioUrl(raw, bankKey) {
    const bank = (window.QUIZ_DATA || {})[bankKey] || {};
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return '';
    if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
    const rel = value.replace(/^\.?\//, '');
    // 仓库约定路径：quizzes/ 里已上线的题库和用户本地已导入的旧副本都长这样
    if (rel.startsWith('audio/')) return joinUrl(RAW_REPO_BASE(), rel);
    if (typeof bank.audioBase === 'string' && bank.audioBase.trim()) return joinUrl(bank.audioBase, rel);
    // 没有 audioBase 的裸相对路径：只在浏览器本地预览有意义，App 里会 404，交给失败提示
    return rel;
  }

  // 题库只声明前缀 + 题号范围时，按 id 推断文件名
  function audioUrlFromBankRange(q, bankKey) {
    const bank = (window.QUIZ_DATA || {})[bankKey] || {};
    if (typeof bank.audioBase !== 'string' || !bank.audioBase.trim()) return '';
    const id = Number(q && q.id);
    if (!Number.isInteger(id)) return '';
    const range = bank.audioIds;
    if (Array.isArray(range) && !range.map(Number).includes(id)) return '';
    if (Array.isArray(bank.audioRange) && (id < Number(bank.audioRange[0]) || id > Number(bank.audioRange[1]))) return '';
    const ext = typeof bank.audioExt === 'string' && /^\.[a-z0-9]+$/i.test(bank.audioExt) ? bank.audioExt : '.m4a';
    return joinUrl(bank.audioBase, `${id}${ext}`);
  }

  function audioCacheKey(bankKey, url) {
    const file = String(url).split('?')[0].split('/').pop() || String(url);
    return `${bankKey || '?'}::${file}`;
  }

  // 统一识别题目音频，兼容多种常见字段名：
  //   audioUrl / audio_url / mp3 / sound            → 音频文件（相对路径按上面的规则解析）
  //   bank.audioBase（+ audioIds/audioRange）        → 按题库声明推断文件名
  //   audio / audioText / listening / speech / tts  → 走 TTS 朗读（兜底，Android WebView 常常没有引擎）
  //   audio 也可以是 { url } 或 { text } 对象
  function getQuestionAudio(q) {
    if (!q) return null;
    const bankKey = bankKeyOf(q);
    const fallbackText = (typeof q.audio === 'string' && !/^(https?:)?\/\//i.test(q.audio) && !/\.(mp3|m4a|wav|ogg|aac)(\?|$)/i.test(q.audio) ? q.audio : '')
      || q.audioText || q.audio_text || q.audio_script
      || q.listening || q.speech || q.tts || '';

    const raw = q.audio;
    let rawUrl = '';
    if (raw && typeof raw === 'object') {
      rawUrl = raw.url || raw.src || '';
    } else {
      rawUrl = q.audioUrl || q.audio_url || q.mp3 || q.sound
        || (typeof raw === 'string' && (/^(https?:)?\/\//i.test(raw) || /\.(mp3|m4a|wav|ogg|aac)(\?|$)/i.test(raw)) ? raw : '');
    }
    let url = resolveAudioUrl(rawUrl, bankKey);
    if (!url) url = audioUrlFromBankRange(q, bankKey);
    if (url) return { type: 'url', src: url, bankKey, cacheKey: audioCacheKey(bankKey, url), fallbackText };

    if (raw && typeof raw === 'object') {
      const t = raw.text || raw.tts || raw.script;
      if (t && typeof t === 'string') return { type: 'tts', src: t, bankKey };
    }
    if (typeof raw === 'string' && raw && !fallbackText) return { type: 'tts', src: raw, bankKey };
    if (fallbackText) return { type: 'tts', src: fallbackText, bankKey };
    return null;
  }

  // ----- 音频缓存的读写（IndexedDB 对象库 audio，值是 Blob）-----
  // 记录结构：{ cacheKey, bankKey, url, bytes, mime, blob, lastUsed }
  // bankKey 索引用于「删题库连带删音频」，lastUsed 索引用于超出预算时逐出最久没听的。
  function audioCacheGet(cacheKey) {
    return openIdb().then(db => new Promise((resolve, reject) => {
      const rq = db.transaction(IDB_AUDIO_STORE, 'readonly').objectStore(IDB_AUDIO_STORE).get(cacheKey);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    }));
  }

  function audioCachePut(record) {
    return openIdb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_AUDIO_STORE, 'readwrite');
      tx.objectStore(IDB_AUDIO_STORE).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('写入被中止'));
    }));
  }

  // 只刷新 lastUsed（命中缓存时调用，让 LRU 反映真实收听顺序）
  function audioCacheTouch(record) {
    if (!record) return Promise.resolve();
    return audioCachePut({ ...record, lastUsed: Date.now() }).catch(() => {});
  }

  function audioCacheDeleteBank(bankKey) {
    if (!bankKey) return Promise.resolve(0);
    return openIdb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_AUDIO_STORE, 'readwrite');
      const index = tx.objectStore(IDB_AUDIO_STORE).index('bankKey');
      let removed = 0;
      const rq = index.openCursor(IDBKeyRange.only(bankKey));
      rq.onsuccess = () => {
        const cursor = rq.result;
        if (cursor) { cursor.delete(); removed++; cursor.continue(); }
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => reject(tx.error);
    }));
  }

  // 返回 { total, bytes, banks: { bankKey: { count, bytes, files: [cacheKey…] } } }
  function audioCacheStats() {
    return openIdb().then(db => new Promise((resolve, reject) => {
      const banks = {};
      let total = 0, bytes = 0;
      // 游标没走完不能 resolve，所以用游标自己所属的那个事务的 oncomplete
      const tx = db.transaction(IDB_AUDIO_STORE, 'readonly');
      const rq = tx.objectStore(IDB_AUDIO_STORE).openCursor();
      rq.onsuccess = () => {
        const cursor = rq.result;
        if (!cursor) return;
        const rec = cursor.value || {};
        const bk = rec.bankKey || '?';
        if (!banks[bk]) banks[bk] = { count: 0, bytes: 0, files: [] };
        banks[bk].count++;
        banks[bk].bytes += Number(rec.bytes) || 0;
        banks[bk].files.push(rec.cacheKey);
        total++;
        bytes += Number(rec.bytes) || 0;
        cursor.continue();
      };
      rq.onerror = () => reject(rq.error);
      tx.oncomplete = () => resolve({ total, bytes, banks });
      tx.onabort = () => reject(tx.error || new Error('读取被中止'));
    })).catch(() => ({ total: 0, bytes: 0, banks: {} }));
  }

  // 超出预算就按 lastUsed 从旧到新逐出（正在播的那条也在候选里，但播放器已拿到 Blob，不受影响）
  function audioCacheEvict(budget) {
    const limit = budget || AUDIO_CACHE_BUDGET;
    return openIdb().then(db => new Promise((resolve, reject) => {
      const items = [];
      // 注意别写 index.transaction：Chromium 的 IDBIndex/IDBObjectStore 上不暴露这个属性，
      // 取到 undefined 再赋 oncomplete 会抛 TypeError，被外层 catch 吞掉后就是「逐出静默失效」。
      const tx = db.transaction(IDB_AUDIO_STORE, 'readonly');
      const rq = tx.objectStore(IDB_AUDIO_STORE).index('lastUsed').openCursor();
      rq.onsuccess = () => {
        const cursor = rq.result;
        if (cursor) { items.push({ key: cursor.value.cacheKey, bytes: Number(cursor.value.bytes) || 0 }); cursor.continue(); }
      };
      rq.onerror = () => reject(rq.error);
      tx.oncomplete = () => {
        let used = items.reduce((n, it) => n + it.bytes, 0);
        if (used <= limit) { resolve(0); return; }
        const wtx = db.transaction(IDB_AUDIO_STORE, 'readwrite');
        const store = wtx.objectStore(IDB_AUDIO_STORE);
        let freed = 0;
        for (const it of items) {
          if (used <= limit) break;
          store.delete(it.key);
          used -= it.bytes;
          freed += it.bytes;
        }
        wtx.oncomplete = () => resolve(freed);
        wtx.onerror = () => reject(wtx.error);
      };
      tx.onabort = () => reject(tx.error || new Error('读取被中止'));
    })).catch(err => {
      console.warn('音频缓存逐出失败', err);
      return 0;
    });
  }

  // 一组题目里需要联网取的音频（按 cacheKey 去重）
  function collectAudioTargets(questions, bankKey) {
    const targets = [];
    const seen = {};
    (questions || []).forEach(q => {
      const a = getQuestionAudio(bankKey ? { ...q, subjectKey: bankKey } : q);
      if (!a || a.type !== 'url' || seen[a.cacheKey]) return;
      seen[a.cacheKey] = true;
      targets.push(a);
    });
    return targets;
  }

  // 考前预取：考试中途断网就听不到听力了，所以开考前先把这批音频落到本地缓存。
  // 不阻塞开考 —— 下载在后台跑，已缓存的部分立刻能播。
  function ensureExamAudio(bankKey, questions) {
    const targets = collectAudioTargets(questions, bankKey);
    if (!targets.length) return;
    audioCacheStats().then(stats => {
      const missing = targets.filter(t => !(stats.banks[t.bankKey || '?'] || {}).files
        || !stats.banks[t.bankKey || '?'].files.includes(t.cacheKey));
      if (!missing.length) return;
      if (navigator.onLine === false) {
        showToast(`离线，${missing.length} 段听力尚未下载，考试里可能听不到音频`);
        return;
      }
      showToast(`开始下载 ${missing.length} 段未缓存的听力，下载后离线可重复播放`);
      let done = 0, failed = 0;
      const queue = missing.slice();
      const worker = () => {
        const item = queue.shift();
        if (!item) return Promise.resolve();
        return getAudioBlob(item.src, item.cacheKey, item.bankKey)
          .then(() => { done++; }, () => { failed++; })
          .then(worker);
      };
      // 三路并发：raw.githubusercontent 单连接会限速，串行下载整包听力太慢
      Promise.all([worker(), worker(), worker()]).then(() => {
        if (failed) showToast(`听力缓存完成 ${done} 段，失败 ${failed} 段（播放时会重试）`);
        else showToast(`听力已全部缓存到本地（${done} 段），之后离线也能播`);
        refreshAudioCacheBar();
      });
    });
  }

  // 删掉的题库连带清掉它已下载的音频（只在彻底删除 / 清空回收站时调用，进回收站要能恢复）
  function purgeBankAudio(bankKey) {
    return audioCacheDeleteBank(bankKey)
      .then(removed => {
        if (removed) refreshAudioCacheBar();
        return removed;
      })
      .catch(() => 0);
  }

  // 全部音频缓存清零（题库本身不动，音频会按需重新下载）
  function clearAllAudioCache() {
    return openIdb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_AUDIO_STORE, 'readwrite');
      tx.objectStore(IDB_AUDIO_STORE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    })).catch(() => false);
  }

  // 传送门里显示听力音频占了多少空间，并给一个手动清理入口
  function refreshAudioCacheBar() {
    const bar = $('portal-audio-bar');
    if (!bar) return;
    audioCacheStats().then(stats => {
      if (!stats.total) {
        bar.innerHTML = '<span class="audio-cache-note">🎧 听力音频尚未下载：播放或开考时自动取，取过之后离线可播</span>';
        return;
      }
      const banks = Object.keys(stats.banks).length;
      bar.innerHTML = `<span class="audio-cache-note">🎧 已缓存听力 ${stats.total} 段 · ${formatSize(stats.bytes)}（${banks} 个题库）</span>`
        + '<button type="button" class="audio-cache-clear" id="portal-audio-clear-btn">清空</button>';
      const btn = $('portal-audio-clear-btn');
      if (btn) {
        btn.addEventListener('click', () => {
          if (!confirm(`确定清空 ${stats.total} 段已下载的听力音频（${formatSize(stats.bytes)}）吗？\n题库和进度不受影响，下次播放会重新下载。`)) return;
          clearAllAudioCache().then(() => {
            refreshAudioCacheBar();
            showToast('听力音频缓存已清空');
          });
        });
      }
    });
  }

  // ===== 主观题判定 =====
  function isSubjective(q) {
    if (!q) return false;
    return q.subjective === true || ((!Array.isArray(q.options) || q.options.length === 0) && (q.answerText || q.explanation));
  }

  // ===== 渲染主观题参考答案 + 自评 =====
  function renderSubjectiveAnswer(q, container) {
    container.innerHTML = '';

    const answerPanel = document.createElement('div');
    answerPanel.className = 'subjective-answer-panel';

    const title = document.createElement('div');
    title.className = 'subjective-answer-title';
    title.textContent = '📖 参考答案';
    answerPanel.appendChild(title);

    const content = document.createElement('div');
    content.className = 'subjective-answer-content';
    content.textContent = q.answerText || '暂无参考答案';
    answerPanel.appendChild(content);

    if (q.explanation) {
      const exp = document.createElement('div');
      exp.className = 'subjective-explanation';
      exp.textContent = q.explanation;
      answerPanel.appendChild(exp);
    }

    container.appendChild(answerPanel);

    // 自评按钮（练习模式）
    if (!state.isExam && !state.isAssessment) {
      const selfEval = document.createElement('div');
      selfEval.className = 'subjective-self-eval';

      const masteredBtn = document.createElement('button');
      masteredBtn.className = 'self-eval-btn mastered';
      masteredBtn.textContent = '✓ 掌握了';
      masteredBtn.onclick = () => {
        recordSubjectiveAnswer(q, true);
      };

      const needsPracticeBtn = document.createElement('button');
      needsPracticeBtn.className = 'self-eval-btn needs-practice';
      needsPracticeBtn.textContent = '✗ 需巩固';
      needsPracticeBtn.onclick = () => {
        recordSubjectiveAnswer(q, false);
      };

      selfEval.appendChild(masteredBtn);
      selfEval.appendChild(needsPracticeBtn);
      container.appendChild(selfEval);
    } else if (state.isExam) {
      // 考试模式：只显示「标记已作答」
      const markBtn = document.createElement('button');
      markBtn.className = 'mark-answered-btn';
      markBtn.textContent = '✓ 标记已作答';
      markBtn.onclick = () => {
        state.answers[state.currentIndex] = {
          questionId: q.id,
          selected: -2, // 主观题已作答标记
          subjective: true,
          isRight: null // 不计入客观分
        };
        markBtn.disabled = true;
        markBtn.textContent = '已标记';
        showToast('已标记为作答，交卷后可对照参考答案自评');
      };
      container.appendChild(markBtn);
    }
  }

  function recordSubjectiveAnswer(q, mastered) {
    state.answers[state.currentIndex] = {
      questionId: q.id,
      selected: -1,
      subjective: true,
      subjectiveViewed: true,
      isRight: mastered
    };
    if (mastered) {
      state.stats.totalAnswered++;
      state.stats.totalCorrect++;
      saveStats();
      logStudy();
      state.answeredSubjects[state.selectedSubject] = true;
      sfx.correct();
    } else {
      state.stats.totalAnswered++;
      saveStats();
      logStudy();
      state.answeredSubjects[state.selectedSubject] = true;
      addToWrongBook(state.selectedSubject, q);
      sfx.wrong();
    }
    checkAchievements();
    const nextBtn = $('next-btn');
    nextBtn.disabled = false;
    if (state.currentIndex === state.questions.length - 1) {
      nextBtn.textContent = '查看结果';
    }
  }

  // ===== 音效系统（Web Audio API，无外部文件）=====
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return null; }
    }
    return audioCtx;
  }
  function playTone(freq, duration, type = 'sine', volume = 0.15) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }
  const sfx = {
    correct: () => { playTone(660, 0.1, 'sine', 0.12); setTimeout(() => playTone(880, 0.15, 'sine', 0.12), 80); },
    wrong: () => { playTone(200, 0.2, 'sawtooth', 0.1); },
    click: () => { playTone(440, 0.05, 'square', 0.05); },
    levelUp: () => { playTone(523, 0.1, 'sine', 0.15); setTimeout(() => playTone(659, 0.1, 'sine', 0.15), 100); setTimeout(() => playTone(784, 0.2, 'sine', 0.15), 200); }
  };

  // ===== 听力播放（Web Speech API，兼容 Android WebView）=====
  // Capacitor 在 Android 用系统 WebView（Chromium），Web Speech 在 WebView 里有 3 个坑：
  //   1) getVoices() 首次返回空数组，需等 voiceschanged
  //   2) 设备未装 TTS 引擎时 speak() 静默失败，按钮卡 playing
  //   3) 没有 onstart 反馈，状态切换不可靠
  // 下面用 voice 缓存 + watchdog 超时 + onstart 三重兜底。
  let cachedVoices = [];
  let voicesReady = false;
  function refreshVoices() {
    if (!('speechSynthesis' in window)) return;
    const v = window.speechSynthesis.getVoices();
    if (v && v.length) { cachedVoices = v; voicesReady = true; }
  }
  if ('speechSynthesis' in window) {
    refreshVoices();
    try { window.speechSynthesis.addEventListener('voiceschanged', refreshVoices); } catch (e) {}
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  function setAudioBtnState(btn, playing, label) {
    if (!btn) return;
    btn.classList.toggle('playing', playing);
    const lab = btn.querySelector('.audio-label');
    if (lab) lab.textContent = label || (playing ? '播放中…' : '播放');
  }

  function playAudio(text, btn) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      showToast('当前设备不支持语音朗读，且该题未附带音频文件');
      return;
    }
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setAudioBtnState(btn, false);
      return;
    }
    setAudioBtnState(btn, true, '准备中…');

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.85;
    utterance.pitch = 1;
    if (voicesReady) {
      const jaVoice = cachedVoices.find(v => v.lang && v.lang.toLowerCase().startsWith('ja'));
      if (jaVoice) utterance.voice = jaVoice;
    }

    let started = false, ended = false;
    const watchdog = setTimeout(() => {
      if (!started && !ended) {
        try { synth.cancel(); } catch (e) {}
        setAudioBtnState(btn, false);
        showToast('此设备没有可用的日语 TTS 引擎。请在系统「设置 → 语言/无障碍 → 文字转语音」中启用，或安装 Google TTS。');
      }
    }, 4000);

    utterance.onstart = () => { started = true; clearTimeout(watchdog); setAudioBtnState(btn, true); };
    utterance.onend = () => { ended = true; clearTimeout(watchdog); setAudioBtnState(btn, false); };
    utterance.onerror = (e) => {
      ended = true; clearTimeout(watchdog); setAudioBtnState(btn, false);
      const err = (e && e.error) || 'unknown';
      if (err !== 'canceled' && err !== 'interrupted') {
        showToast('播放失败：' + err + (err === 'synthesis-failed' ? '（TTS 引擎异常）' : ''));
      }
    };

    // 某些 Android WebView 直接 speak() 会被吞，延迟一帧后调用更稳
    setTimeout(() => {
      try { synth.speak(utterance); }
      catch (err) {
        ended = true; clearTimeout(watchdog); setAudioBtnState(btn, false);
        showToast('语音引擎异常：' + (err.message || err));
      }
    }, 60);
  }

  // 播放题目音频：本地缓存命中直接播，没命中先下载再播（下载过一次之后就离线可用）。
  // 统一入口 playAudioSrc()：type==='tts' 走设备朗读，type==='url' 走这里。
  let currentAudioEl = null;
  let currentObjectUrl = null;
  let currentAudioKey = '';
  const audioInflight = {}; // cacheKey -> Promise<Blob>，连点或回顾页重复引用时不重复下载

  function stopCurrentAudio(btn) {
    if (currentAudioEl) {
      try { currentAudioEl.pause(); } catch (e) {}
      currentAudioEl = null;
    }
    if (currentObjectUrl) {
      try { URL.revokeObjectURL(currentObjectUrl); } catch (e) {}
      currentObjectUrl = null;
    }
    currentAudioKey = '';
    setAudioBtnState(btn, false);
  }

  function releaseAudioUrl() {
    if (currentObjectUrl) {
      try { URL.revokeObjectURL(currentObjectUrl); } catch (e) {}
      currentObjectUrl = null;
    }
  }

  // 取音频 Blob：缓存 → 正在进行的下载 → 联网下载并写缓存
  function getAudioBlob(url, cacheKey, bankKey) {
    return audioCacheGet(cacheKey).catch(() => null).then(hit => {
      if (hit && hit.blob) { audioCacheTouch(hit); return hit.blob; }
      if (audioInflight[cacheKey]) return audioInflight[cacheKey];
      const task = fetch(url, { cache: 'force-cache' })
        .then(res => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const mime = (res.headers.get('content-type') || '').toLowerCase();
          if (mime.includes('text/')) throw new Error('地址返回的是网页不是音频（' + mime + '）');
          return res.blob();
        })
        .then(blob => {
          if (!blob || !blob.size) throw new Error('音频为空');
          // GitHub raw 取不到文件时返回 14 字节的 "404: Not Found"，别把它当音频存下来
          if (blob.size < 1024) throw new Error('音频内容异常（' + blob.size + ' 字节）');
          return audioCachePut({
            cacheKey, bankKey: bankKey || '', url,
            bytes: blob.size, mime: blob.type || 'audio/mp4', blob, lastUsed: Date.now()
          }).catch(err => {
            console.warn('音频写缓存失败（配额可能不足），本次仍可播放', err);
            return null;
          }).then(() => audioCacheEvict().catch(() => null)).then(() => blob);
        });
      audioInflight[cacheKey] = task;
      const cleanup = () => { if (audioInflight[cacheKey] === task) delete audioInflight[cacheKey]; };
      task.then(cleanup, cleanup);
      return task;
    });
  }

  function playRemoteAudio(audioSrc, btn) {
    if (currentAudioEl && currentAudioKey === audioSrc.cacheKey) {
      stopCurrentAudio(btn);
      return;
    }
    stopCurrentAudio(btn);
    currentAudioKey = audioSrc.cacheKey;
    setAudioBtnState(btn, true, '加载中…');

    getAudioBlob(audioSrc.src, audioSrc.cacheKey, audioSrc.bankKey).then(blob => {
      // 等待期间用户又点了别的题：这一条直接丢弃
      if (currentAudioKey !== audioSrc.cacheKey) return;
      const objectUrl = URL.createObjectURL(blob);
      currentObjectUrl = objectUrl;
      const audio = new Audio(objectUrl);
      audio.preload = 'auto';
      currentAudioEl = audio;
      audio.onplay = () => setAudioBtnState(btn, true, '播放中…');
      audio.onended = () => { if (currentAudioKey === audioSrc.cacheKey) stopCurrentAudio(btn); };
      audio.onerror = () => {
        if (currentAudioKey !== audioSrc.cacheKey) return;
        stopCurrentAudio(btn);
        showToast('音频解码失败，格式可能不受设备支持');
      };
      audio.play().catch(err => {
        if (currentAudioKey !== audioSrc.cacheKey) return;
        stopCurrentAudio(btn);
        showToast('播放失败：' + (err.message || err));
      });
    }).catch(err => {
      if (currentAudioKey !== audioSrc.cacheKey) return;
      stopCurrentAudio(btn);
      const msg = (err && err.message) || String(err);
      // 取不到文件时题目原文还在，能读的设备就用 TTS 顶一下
      if (audioSrc.fallbackText && /无网络|Network|Failed to fetch|fetch/i.test(msg)) {
        showToast('离线且未缓存该音频，改用语音朗读');
        playAudio(audioSrc.fallbackText, btn);
        return;
      }
      showToast('音频加载失败：' + msg + '（请检查网络，或确认题库的音频地址可访问）');
    });
  }

  function playAudioSrc(audioSrc, btn) {
    if (!audioSrc) return;
    if (audioSrc.type === 'url') playRemoteAudio(audioSrc, btn);
    else playAudio(audioSrc.src, btn);
  }

  // ===== 每日一言 =====
  const DAILY_QUOTES = [
    '今天也要元气满满地学习呀！✨',
    '努力的人运气都不会太差 🍀',
    '每一道题都是通往成功的台阶 🪜',
    '坚持就是胜利，你比想象中更强 💪',
    '学海无涯，刷题作舟 🚣',
    '愿你合上笔盖的那一刻，有战士收刀入鞘的骄傲 ⚔️',
    '天赋决定上限，努力决定下限 🌟',
    '别让明天的你，讨厌今天的自己 ⏰',
    '乾坤未定，你我皆是黑马 🐎',
    '再坚持一下，上岸就在前方 🏊'
  ];
  function getDailyQuote() {
    const today = new Date().toDateString();
    let idx = 0;
    for (let i = 0; i < today.length; i++) idx += today.charCodeAt(i);
    return DAILY_QUOTES[idx % DAILY_QUOTES.length];
  }

  // ===== 教资考试倒计时数据 =====
  // 来源：教育部教育考试院公告 / 行业汇总（未官方公布的日期标注「预计」）
  const TEACHER_EXAM_SCHEDULE = [
    { name: '2026年下半年 中小学教师资格面试', date: '2026-12-05', endDate: '2026-12-06', confirmed: true },
    { name: '2027年上半年 中小学教师资格笔试', date: '2027-03-06', endDate: '2027-03-06', confirmed: false },
    { name: '2027年上半年 中小学教师资格面试', date: '2027-05-15', endDate: '2027-05-16', confirmed: false },
    { name: '2027年下半年 中小学教师资格笔试', date: '2027-09-11', endDate: '2027-09-11', confirmed: false },
    { name: '2027年下半年 中小学教师资格面试', date: '2027-12-04', endDate: '2027-12-05', confirmed: false }
  ];

  // 统一考试日期展示格式：单日「2027年03月06日」，同期跨天「2026年12月05日 至 06日」，跨月跨年则两侧都写全
  function formatExamDate(exam) {
    const cn = (s) => `${s.slice(0, 4)}年${s.slice(5, 7)}月${s.slice(8, 10)}日`;
    if (!exam.endDate || exam.date === exam.endDate) return cn(exam.date);
    const sameMonth = exam.date.slice(0, 7) === exam.endDate.slice(0, 7);
    return sameMonth
      ? `${cn(exam.date)} 至 ${exam.endDate.slice(5, 7)}月${exam.endDate.slice(8, 10)}日`
      : `${cn(exam.date)} 至 ${cn(exam.endDate)}`;
  }

  function renderExamCountdown() {
    const container = $('exam-countdown-list');
    if (!container) return;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const upcoming = TEACHER_EXAM_SCHEDULE.filter(e => {
      const end = new Date(e.endDate + 'T00:00:00');
      return end >= now;
    }).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 2);

    if (upcoming.length === 0) {
      container.innerHTML = '<div class="countdown-empty">暂无即将到来的考试安排</div>';
      return;
    }

    container.innerHTML = upcoming.map(exam => {
      const examDate = new Date(exam.date + 'T00:00:00');
      const diffDays = Math.ceil((examDate - now) / 86400000);
      const tag = exam.confirmed ? '' : '<span class="countdown-tag">预计</span>';
      return `
        <div class="countdown-item">
          <div class="countdown-name">${tag}${escapeHtml(exam.name)}</div>
          <div class="countdown-meta">
            <div class="countdown-date">${formatExamDate(exam)}</div>
            <div class="countdown-days">还有 <strong>${diffDays}</strong> 天</div>
          </div>
        </div>`;
    }).join('');
  }

  // ===== XP / 等级系统 =====
  function xpForLevel(level) { return level * 100; }
  function loadXp() {
    const saved = localStorage.getItem(XP_STORAGE);
    if (saved) {
      try {
        const d = JSON.parse(saved);
        state.xp = d.xp || 0;
        state.level = d.level || 1;
      } catch (e) {}
    }
  }
  function saveXp() {
    localStorage.setItem(XP_STORAGE, JSON.stringify({ xp: state.xp, level: state.level }));
  }
  function addXp(amount) {
    state.xp += amount;
    let leveledUp = false;
    while (state.xp >= xpForLevel(state.level)) {
      state.xp -= xpForLevel(state.level);
      state.level++;
      leveledUp = true;
    }
    saveXp();
    return leveledUp;
  }

  // ===== 连续打卡 =====
  function updateStreak() {
    const today = new Date().toDateString();
    const saved = localStorage.getItem(STREAK_STORAGE);
    if (saved) {
      try {
        const d = JSON.parse(saved);
        if (d.lastDate === today) return; // 今天已打卡
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        if (d.lastDate === yesterday) {
          state.streakDays = (d.days || 1) + 1;
        } else {
          state.streakDays = 1;
        }
      } catch (e) { state.streakDays = 1; }
    }
    state.streakLastDate = today;
    localStorage.setItem(STREAK_STORAGE, JSON.stringify({ days: state.streakDays, lastDate: today }));
  }

  // ===== DOM 元素 =====
  const $ = (id) => document.getElementById(id);
  const pages = {
    home: $('page-home'),
    quiz: $('page-quiz'),
    result: $('page-result')
  };

  // ===== 工具函数 =====
  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let currentPage = 'home'; // 当前页面，供 Android 返回键判断返回层级

  function showPage(pageName) {
    currentPage = pageName;
    Object.values(pages).forEach(p => p.classList.remove('active'));
    pages[pageName].classList.add('active');
    // 结果页被普通刷题、考试、套卷、测评、历史结果五个入口复用。
    // 测评专用的分析区在进页时统一清空，谁要显示就在 showPage('result') 之后自己填，
    // 免得新增一个复用点就漏一次（漏掉的后果是上个测评的分析区残留在考试结果页上）。
    if (pageName === 'result') renderAssessmentDetail(null);
    window.scrollTo(0, 0);
  }

  function loadStats() {
    try {
      const saved = localStorage.getItem('quiz-stats');
      if (saved) {
        const data = JSON.parse(saved);
        state.stats = { ...state.stats, ...data };
      }
      // 计算连续打卡天数
      const today = new Date().toDateString();
      if (state.stats.lastDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        if (state.stats.lastDate === yesterday) {
          state.stats.streakDays = (state.stats.streakDays || 0) + 1;
        } else if (state.stats.lastDate !== today) {
          state.stats.streakDays = 1;
        }
        state.stats.lastDate = today;
        saveStats();
      }
    } catch (e) {
      console.warn('加载统计数据失败', e);
    }
  }

  function saveStats() {
    try {
      localStorage.setItem('quiz-stats', JSON.stringify(state.stats));
    } catch (e) {
      console.warn('保存统计数据失败', e);
    }
  }

  function updateStatsUI() {
    $('stat-total').textContent = state.stats.totalAnswered;
    const rate = state.stats.totalAnswered > 0
      ? Math.round((state.stats.totalCorrect / state.stats.totalAnswered) * 100)
      : 0;
    $('stat-rate').textContent = rate + '%';
    $('stat-streak').textContent = state.stats.streakDays + '天';
  }

  // ===== 首页渲染 =====
  function renderSubjectList() {
    const container = $('subject-list');
    container.innerHTML = '';
    const subjects = Object.entries(window.QUIZ_DATA || {});

    subjects.forEach(([key, subject]) => {
      const card = document.createElement('div');
      const isImported = !!state.importedKeys[key];
      card.className = 'subject-card' + (isImported ? ' imported' : '');
      card.dataset.subject = key;
      card.innerHTML = `
        <div class="subject-actions">
          <button class="delete-btn" title="删除到回收站" data-key="${key}">🗑️</button>
        </div>
        <div class="subject-icon">${subject.icon}</div>
        <div class="subject-name">${subject.name}</div>
        <div class="subject-desc">${subject.description || ''}</div>
        <div class="subject-count">共 ${subject.questions.length} 题${isImported ? ' · 已导入' : ''}</div>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.delete-btn')) return;
        selectSubject(key);
      });
      const delBtn = card.querySelector('.delete-btn');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          moveToRecycleBin(key);
        });
      }
      container.appendChild(card);
    });
  }

  function selectSubject(key) {
    state.selectedSubject = key;
    state.activeCategory = null;
    document.querySelectorAll('.subject-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.subject === key);
    });
    renderCategoryChips();
    checkStartButton();
  }

  // ===== 套卷识别与分节 =====
  // 带 preserveOrder 或 sections 的 exam 元数据，视为“套卷”而非普通题库：
  // 题量、时长、顺序都由卷面决定，首页不再让用户自选。
  function isPaperBank(subject) {
    if (!subject || subject.type === 'assessment') return false;
    const preset = subject.exam;
    if (!preset || typeof preset !== 'object') return false;
    return preset.preserveOrder === true || (Array.isArray(preset.sections) && preset.sections.length > 0);
  }

  function getPaperTotal(subject, preset) {
    const total = Array.isArray(subject.questions) ? subject.questions.length : 0;
    const presetCount = parseInt(preset && preset.count, 10);
    return presetCount > 0 ? Math.min(presetCount, total) : total;
  }

  function buildPaperSections(preset, total) {
    const raw = Array.isArray(preset.sections) ? preset.sections : [];
    const sections = [];
    let cursor = 0;
    raw.forEach((s, i) => {
      if (!s || cursor >= total) return;
      const remain = total - cursor;
      const count = Math.max(0, Math.min(parseInt(s.count, 10) || 0, remain));
      if (!count) return;
      const minutes = Math.max(1, parseInt(s.minutes, 10) || 0);
      sections.push({
        name: s.name || `第 ${i + 1} 节`,
        count,
        minutes,
        start: cursor,
        end: cursor + count - 1
      });
      cursor += count;
    });
    // 分区题量少于卷面总题量时补一节，确保不丢题
    if (cursor < total) {
      const presetMinutes = Math.max(1, parseInt(preset.minutes, 10) || 0);
      const usedMinutes = sections.reduce((sum, s) => sum + s.minutes, 0);
      const minutes = Math.max(1, presetMinutes - usedMinutes || Math.ceil((total - cursor) / 2));
      sections.push({
        name: '补充试题',
        count: total - cursor,
        minutes,
        start: cursor,
        end: total - 1
      });
    }
    if (!sections.length) {
      sections.push({
        name: '整卷',
        count: total,
        minutes: Math.max(1, parseInt(preset.minutes, 10) || 90),
        start: 0,
        end: total - 1
      });
    }
    return sections;
  }

  function renderPaperCard(subject) {
    const preset = subject.exam || {};
    const total = getPaperTotal(subject, preset);
    const sections = buildPaperSections(preset, total);
    const minutes = sections.reduce((sum, s) => sum + s.minutes, 0);

    const titleEl = $('paper-card-title');
    if (titleEl) titleEl.textContent = subject.name || '模拟套卷';
    const subEl = $('paper-card-sub');
    if (subEl) subEl.textContent = '按真实卷面顺序整卷作答';

    const metaEl = $('paper-meta');
    if (metaEl) {
      const items = [
        `📄 整卷 ${total} 题`,
        `⏱️ 共 ${minutes} 分钟`,
        `🧭 ${sections.length} 节`,
        '🏁 交卷后统一判分'
      ];
      metaEl.innerHTML = items.map(t => `<span class="paper-meta-item">${escapeHtml(t)}</span>`).join('');
    }

    const secEl = $('paper-sections-preview');
    if (secEl) {
      secEl.innerHTML = sections.map((s, i) => `
        <div class="paper-section-preview">
          <span class="paper-step">${i + 1}</span>
          <span class="paper-sec-name">${escapeHtml(s.name)}</span>
          <span class="paper-sec-meta">${s.count} 题 · ${s.minutes} 分</span>
        </div>
      `).join('');
    }

    const noteEl = $('paper-note');
    if (noteEl) {
      const desc = preset.description ? `${preset.description}\n` : '';
      noteEl.textContent = `${desc}套卷按卷面顺序整卷作答，各节独立计时；本节结束后不可回看，交卷后统一判分。`;
    }
  }

  // ===== 题量和模式选择 =====
  function initSettings() {
    const qtySlider = $('qty-slider');
    const qtyValueEl = $('qty-value');
    if (qtySlider) {
      qtySlider.addEventListener('input', () => {
        state.qty = parseInt(qtySlider.value, 10);
        if (qtyValueEl) qtyValueEl.textContent = state.qty;
      });
      // 初始化显示
      qtySlider.value = state.qty;
      if (qtyValueEl) qtyValueEl.textContent = state.qty;
    }

    $('mode-options').addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
    });

    $('start-btn').addEventListener('click', startQuiz);

    // 套卷专属入口：直接按卷面预设开始，不再弹题量/时长配置
    $('paper-start-btn').addEventListener('click', startPaperExam);
    $('paper-practice-btn').addEventListener('click', startPaperPractice);

    // 套卷分节弹窗
    $('paper-section-next-btn').addEventListener('click', () => {
      const next = state.paperPendingSection;
      if (next === null || next === undefined) return;
      startPaperSection(next);
    });
    $('paper-section-submit-btn').addEventListener('click', () => {
      if (!window.confirm('确定结束套卷考试并交卷吗？未作答题目将计为错误。')) return;
      closePaperSectionModal();
      submitExam();
    });

    // 测评型题库专属按钮
    $('as-start-btn').addEventListener('click', startQuiz);
    $('as-resume-btn').addEventListener('click', () => resumeAssessment(state.selectedSubject));
    $('as-view-btn').addEventListener('click', () => viewAssessmentResult(state.selectedSubject));
    $('as-clear-btn').addEventListener('click', () => {
      if (!state.selectedSubject) return;
      if (!window.confirm('确定清除该测试的进度与历史结果吗？')) return;
      clearAssessmentDraft(state.selectedSubject);
      clearAssessmentResult(state.selectedSubject);
      checkStartButton();
      showToast('已清除测试进度与结果');
    });
  }

  // ===== 测评型题库：进度缓存 / 历史结果 / 专属按钮 =====
  const ASSESSMENT_DRAFT_PREFIX = 'assessment-draft__';
  const ASSESSMENT_RESULT_PREFIX = 'assessment-result__';

  function getAssessmentDraft(key) {
    try { return JSON.parse(localStorage.getItem(ASSESSMENT_DRAFT_PREFIX + key)); } catch (e) { return null; }
  }
  function saveAssessmentDraft(key, data) {
    try { localStorage.setItem(ASSESSMENT_DRAFT_PREFIX + key, JSON.stringify(data)); } catch (e) {}
  }
  function clearAssessmentDraft(key) { localStorage.removeItem(ASSESSMENT_DRAFT_PREFIX + key); }
  function getAssessmentResult(key) {
    try { return JSON.parse(localStorage.getItem(ASSESSMENT_RESULT_PREFIX + key)); } catch (e) { return null; }
  }
  function saveAssessmentResult(key, data) {
    try { localStorage.setItem(ASSESSMENT_RESULT_PREFIX + key, JSON.stringify(data)); } catch (e) {}
  }
  function clearAssessmentResult(key) { localStorage.removeItem(ASSESSMENT_RESULT_PREFIX + key); }

  // 校验缓存的题目快照与当前题库一致（题库被覆盖/更新后旧缓存作废）
  function questionsMatchSnapshot(subject, snapshot) {
    if (!snapshot || !Array.isArray(snapshot) || snapshot.length !== subject.questions.length) return false;
    return snapshot.every((q, i) => q && q.question === subject.questions[i].question);
  }

  // 首页：按选中题库类型切换 刷题设置/套卷/测评按钮，并刷新按钮状态
  function checkStartButton() {
    const key = state.selectedSubject;
    const subject = key ? window.QUIZ_DATA[key] : null;
    const has = !!subject;
    const isAss = !!(subject && subject.type === 'assessment');
    const isPaper = isPaperBank(subject);
    const settingsCard = $('quiz-settings-card');
    const settingsTitle = $('quiz-settings-title');
    const assActions = $('assessment-actions');
    const normalActions = $('normal-actions');
    const paperTitle = $('paper-mode-title');
    const paperCard = $('paper-mode-card');
    const paperActions = $('paper-actions');

    if (settingsCard) settingsCard.style.display = (isAss || isPaper) ? 'none' : '';
    if (settingsTitle) settingsTitle.style.display = (isAss || isPaper) ? 'none' : '';
    if (assActions) assActions.style.display = isAss ? 'flex' : 'none';
    if (normalActions) normalActions.style.display = (isAss || isPaper) ? 'none' : 'flex';
    if (paperTitle) paperTitle.style.display = isPaper ? '' : 'none';
    if (paperCard) paperCard.style.display = isPaper ? '' : 'none';
    if (paperActions) paperActions.style.display = isPaper ? 'flex' : 'none';

    if (isPaper) {
      state.activeCategory = null;
      const categorySection = $('category-section');
      if (categorySection) categorySection.style.display = 'none';
      renderPaperCard(subject);
    } else if (has && !isAss) {
      // 普通题库：从滑块读取当前题量
      const qtySlider = $('qty-slider');
      if (qtySlider) {
        const qty = parseInt(qtySlider.value, 10);
        if (qty > 0) state.qty = qty;
      }
    }

    $('start-btn').disabled = !has || isAss || isPaper;
    $('exam-start-btn').disabled = !has || isAss || isPaper;
    if (isPaper || !isAss || !key) return;

    // 测评按钮状态机：
    //   有未完成进度 → 继续测试 + 清除
    //   无进度但有历史结果 → 开始测试 + 查看结果 + 清除
    //   都没有 → 开始测试
    const draft = getAssessmentDraft(key);
    const last = getAssessmentResult(key);
    const hasDraft = !!(draft && Array.isArray(draft.answers) && draft.answers.some(a => a && a.tag));
    $('as-start-btn').style.display = hasDraft ? 'none' : '';
    $('as-resume-btn').style.display = hasDraft ? '' : 'none';
    $('as-view-btn').style.display = last ? '' : 'none';
    $('as-clear-btn').style.display = (hasDraft || last) ? '' : 'none';
    const resumeText = $('as-resume-btn').querySelector('span:last-child');
    if (resumeText) {
      const done = draft.answers.filter(a => a && a.tag).length;
      resumeText.textContent = `继续测试（${done}/${draft.questions ? draft.questions.length : '?'}）`;
    }
  }

  function resumeAssessment(key) {
    const draft = getAssessmentDraft(key);
    const subject = window.QUIZ_DATA[key];
    if (!draft || !subject || !questionsMatchSnapshot(subject, draft.questions)) {
      clearAssessmentDraft(key);
      checkStartButton();
      showToast('缓存的测试进度已失效，请重新开始');
      return;
    }
    state.selectedSubject = key;
    state.activeCategory = null;
    state.isAssessment = true;
    state.isExam = false;
    state.paperMode = false;
    state.paperPracticeMode = false;
    state.paperSections = [];
    state.questions = draft.questions;
    state.answers = draft.answers;
    state.currentIndex = Math.min(draft.currentIndex || 0, draft.questions.length - 1);
    showPage('quiz');
    renderQuestion();
  }

  function viewAssessmentResult(key) {
    const saved = getAssessmentResult(key);
    if (!saved) { showToast('暂无历史测试结果'); return; }
    const scoreBox = $('result-score-box');
    const detailBox = $('result-detail-box');
    if (scoreBox) scoreBox.style.display = 'none';
    if (detailBox) detailBox.style.display = 'none';
    $('review-section').style.display = 'none';
    $('result-icon').textContent = saved.icon || '🎯';
    $('result-title').textContent = saved.title || saved.key;
    const date = new Date(saved.finishedAt || Date.now());
    $('result-message').textContent =
      `测试完成于 ${date.toLocaleDateString()} ${date.toLocaleTimeString().slice(0, 5)} · 作答 ${saved.answeredCount}/${saved.total} 题\n\n${saved.description || ''}`;
    $('retry-btn').textContent = '重新测试';
    showPage('result');

    // 历史结果只存了 key/icon/title/description，八个分析字段回到题库里取。
    // 题库可能已被删除或换版，取不到就干净地留空，不显示错的内容。
    const bank = window.QUIZ_DATA[key] || {};
    const hit = (bank.results || []).find(r => r.key === saved.key);
    renderAssessmentDetail(hit || null);
  }

  // ===== 开始刷题 =====
  function startQuiz() {
    if (!state.selectedSubject) return;

    // 普通刷题/考试入口：清理可能残留的套卷状态
    state.paperMode = false;
    state.paperPracticeMode = false;
    state.paperSections = [];
    state.paperSectionIndex = 0;
    state.paperSectionTimeLeft = 0;
    state.paperPendingSection = null;

    const subject = window.QUIZ_DATA[state.selectedSubject];
    let questions = [...subject.questions];

    // 分类筛选
    if (state.activeCategory) {
      questions = questions.filter(q => q.category === state.activeCategory);
      if (questions.length === 0) {
        showToast('该分类下暂无题目');
        return;
      }
    }

    // 测评型题库（MBTI 等）：全量题目按原顺序作答，无数量/模式配置
    state.isAssessment = subject.type === 'assessment';
    if (state.isAssessment) {
      state.isExam = false;
      questions = subject.questions.slice();
      // 开始新测试：重置进度缓存
      clearAssessmentDraft(state.selectedSubject);
      saveAssessmentDraft(state.selectedSubject, { answers: [], currentIndex: 0, questions: questions });
      state.qty = questions.length;
      state.questions = questions;
      state.currentIndex = 0;
      state.answers = [];
      state.combo = 0;
      showPage('quiz');
      renderQuestion();
      return;
    }

    // 根据模式选择题目；套卷（exam.preserveOrder）在考试模式下保持真实卷面顺序
    const examPreset = subject.exam || {};
    const shouldShuffle = state.isExam ? !examPreset.preserveOrder : state.mode === 'random';
    if (shouldShuffle) {
      questions = shuffleArray(questions);
    }

    // 取指定数量的题目
    const qty = Math.min(state.qty, questions.length);
    state.questions = questions.slice(0, qty);
    state.currentIndex = 0;
    state.answers = [];
    state.combo = 0; // 重置连击

    showPage('quiz');
    renderQuestion();

    // 考试模式：启动倒计时
    if (state.isExam) {
      startExamTimer();
      // 考试中途断网就听不到听力，开考前把这一批音频先缓存到本地
      ensureExamAudio(state.selectedSubject, state.questions);
    }
  }

  // ===== 套卷考试 / 套卷练习 =====
  // 套卷不经过“题量/时长”配置：整卷题序、分节时长全部来自题库 exam 元数据。
  function startPaperExam() {
    const key = state.selectedSubject;
    const subject = key ? window.QUIZ_DATA[key] : null;
    if (!isPaperBank(subject)) {
      showToast('请选择一个套卷题库');
      return;
    }
    const preset = subject.exam || {};
    const total = getPaperTotal(subject, preset);
    if (!total) {
      showToast('该套卷暂无题目');
      return;
    }

    const questions = subject.questions.slice(0, total);
    const sections = buildPaperSections(preset, total);

    stopExamTimer();
    closePaperSectionModal();
    state.isAssessment = false;
    state.reviewMode = false;
    state.isExam = true;
    state.paperMode = true;
    state.paperPracticeMode = false;
    state.activeCategory = null;
    state.mode = 'sequential';
    state.questions = questions;
    state.currentIndex = 0;
    state.answers = [];
    state.combo = 0;
    state.paperSections = sections;
    state.paperSectionIndex = 0;
    state.paperSectionTimeLeft = sections[0].minutes * 60;
    state.examTimeLimit = sections.reduce((sum, s) => sum + s.minutes, 0) * 60;
    state.examTimeLeft = state.examTimeLimit;

    showPage('quiz');
    renderQuestion();
    startExamTimer();
    showToast(`套卷考试开始：${total} 题 · 共 ${Math.round(state.examTimeLimit / 60)} 分钟`);
    ensureExamAudio(key, questions);
  }

  function startPaperPractice() {
    const key = state.selectedSubject;
    const subject = key ? window.QUIZ_DATA[key] : null;
    if (!isPaperBank(subject)) {
      showToast('请选择一个套卷题库');
      return;
    }
    const preset = subject.exam || {};
    const total = getPaperTotal(subject, preset);
    if (!total) {
      showToast('该套卷暂无题目');
      return;
    }

    stopExamTimer();
    closePaperSectionModal();
    state.isAssessment = false;
    state.reviewMode = false;
    state.isExam = false;
    state.paperMode = false;
    state.paperPracticeMode = true;
    state.activeCategory = null;
    state.mode = 'sequential';
    state.questions = subject.questions.slice(0, total);
    state.currentIndex = 0;
    state.answers = [];
    state.combo = 0;
    state.paperSections = [];
    state.paperSectionIndex = 0;
    state.paperSectionTimeLeft = 0;
    state.examTimeLimit = 0;
    state.examTimeLeft = 0;

    showPage('quiz');
    renderQuestion();
    showToast('套卷练习：按卷面顺序作答，答完即时显示解析');
  }

  function startPaperSection(index) {
    const section = state.paperSections[index];
    if (!section) return;
    closePaperSectionModal();
    state.paperSectionIndex = index;
    state.paperSectionTimeLeft = section.minutes * 60;
    state.currentIndex = section.start;
    showPage('quiz');
    renderQuestion();
    startExamTimer();
    showToast(`第 ${index + 1} 节 · ${section.name}（${section.minutes} 分钟）`);
  }

  function closePaperSectionModal() {
    const modal = $('paper-section-modal');
    if (modal) modal.style.display = 'none';
    state.paperPendingSection = null;
  }

  function countPaperSectionAnswers(section) {
    let answered = 0;
    for (let i = section.start; i <= section.end; i++) {
      const ans = state.answers[i];
      if (ans && ans.selected >= 0) answered++;
    }
    return answered;
  }

  function showPaperSectionModal(completedIndex, reason) {
    const completed = state.paperSections[completedIndex];
    const next = state.paperSections[completedIndex + 1];
    if (!completed || !next) return;

    const answered = countPaperSectionAnswers(completed);
    const unanswered = completed.count - answered;
    state.paperPendingSection = completedIndex + 1;

    $('paper-section-modal-icon').textContent = reason === 'timeup' ? '⏰' : '✅';
    $('paper-section-modal-title').textContent =
      reason === 'timeup' ? '本节时间到' : '本节已结束';
    $('paper-section-modal-desc').textContent = reason === 'timeup'
      ? `「${completed.name}」答题时间已用完，本节答案已锁定，不能返回修改。`
      : `「${completed.name}」已结束，本节答案已锁定，不能返回修改。`;
    $('paper-section-modal-stats').innerHTML = `
      <div class="paper-modal-stat"><span class="pm-value">${answered}</span><span class="pm-label">已作答</span></div>
      <div class="paper-modal-stat"><span class="pm-value">${unanswered}</span><span class="pm-label">未作答</span></div>
      <div class="paper-modal-stat"><span class="pm-value">${next.minutes}分</span><span class="pm-label">下节时长</span></div>
    `;
    $('paper-section-modal-next').innerHTML =
      `下一节：<strong>${escapeHtml(next.name)}</strong><br>${next.count} 题 · ${next.minutes} 分钟 · 独立计时`;
    $('paper-section-next-btn').textContent = `进入第 ${completedIndex + 2} 节`;
    $('paper-section-modal').style.display = 'flex';
  }

  function handlePaperSectionTimeout() {
    const isLast = state.paperSectionIndex >= state.paperSections.length - 1;
    if (isLast) {
      showToast('考试时间到，自动交卷');
      submitExam();
      return;
    }
    showToast('本节时间到，答案已锁定');
    showPaperSectionModal(state.paperSectionIndex, 'timeup');
  }

  // 套卷考试中点击“下一题 / 进入下一节 / 交卷”
  function handlePaperNext() {
    const section = state.paperSections[state.paperSectionIndex];
    if (!section) return;
    if (state.currentIndex < section.end) {
      goToQuestion(state.currentIndex + 1);
      return;
    }

    const isLastSection = state.paperSectionIndex >= state.paperSections.length - 1;
    if (isLastSection) {
      const unanswered = state.questions.filter((q, i) => {
        const ans = state.answers[i];
        return !ans || ans.selected < 0;
      }).length;
      if (unanswered > 0 && !window.confirm(`还有 ${unanswered} 题未作答，确定交卷吗？`)) return;
      submitExam();
      return;
    }

    if (!window.confirm(`「${section.name}」还未结束，确定提前进入下一节吗？本节剩余时间不会保留。`)) return;
    stopExamTimer();
    showPaperSectionModal(state.paperSectionIndex, 'early');
  }

  // ===== 模拟考试 =====
  function openExamConfig() {
    if (!state.selectedSubject) {
      showToast('请先选择一个科目');
      return;
    }
    const subject = window.QUIZ_DATA[state.selectedSubject] || {};
    // 套卷有完整预设，直接开考，不弹配置窗
    if (isPaperBank(subject)) {
      startPaperExam();
      return;
    }
    const preset = subject.exam && typeof subject.exam === 'object' ? subject.exam : {};
    const total = Array.isArray(subject.questions) ? subject.questions.length : 0;

    // 套卷元数据：预填题量、时长与分区说明；普通题库沿用默认值
    const countInput = $('exam-count');
    if (countInput) {
      countInput.value = preset.count || Math.min(total || 10, 200);
      if (total) countInput.max = Math.max(total, 1);
    }
    const timeSelect = $('exam-time');
    if (timeSelect) {
      const minutes = preset.minutes || 10;
      if (![...timeSelect.options].some(o => Number(o.value) === minutes)) {
        const opt = document.createElement('option');
        opt.value = String(minutes);
        opt.textContent = `${minutes} 分钟`;
        timeSelect.appendChild(opt);
      }
      timeSelect.value = String(minutes);
    }
    const descEl = $('exam-modal-desc');
    if (descEl) {
      descEl.textContent = preset.description ||
        '设置考试参数，开始后计时，交卷后统一判分。';
    }
    const secEl = $('exam-sections');
    if (secEl) {
      const sections = Array.isArray(preset.sections) ? preset.sections : [];
      if (sections.length) {
        secEl.innerHTML = sections.map(s =>
          `<div class="exam-section-row"><span>${escapeHtml(s.name || '')}</span><span>${Number(s.count) || 0} 题 · ${Number(s.minutes) || 0} 分钟</span></div>`
        ).join('');
        secEl.style.display = 'block';
      } else {
        secEl.innerHTML = '';
        secEl.style.display = 'none';
      }
    }
    $('exam-modal').style.display = 'flex';
  }

  function closeExamConfig() {
    $('exam-modal').style.display = 'none';
  }

  function beginExam() {
    const count = parseInt($('exam-count').value, 10);
    const minutes = parseInt($('exam-time').value, 10);
    if (!count || count < 1) {
      showToast('请输入有效的题目数量');
      return;
    }
    state.qty = count;
    state.isExam = true;
    state.examTimeLimit = minutes * 60;
    state.examTimeLeft = state.examTimeLimit;
    closeExamConfig();
    startQuiz();
  }

  function startExamTimer() {
    stopExamTimer();
    updateExamTimerDisplay();
    state.examTimer = setInterval(() => {
      // 套卷：头部显示本节剩余时间，按 exam.sections 独立计时
      if (state.paperMode && state.paperSections.length) {
        state.paperSectionTimeLeft = Math.max(0, state.paperSectionTimeLeft - 1);
        state.examTimeLeft = Math.max(0, state.examTimeLeft - 1);
        updateExamTimerDisplay();
        if (state.paperSectionTimeLeft <= 0) {
          stopExamTimer();
          handlePaperSectionTimeout();
        }
        return;
      }

      state.examTimeLeft--;
      updateExamTimerDisplay();
      if (state.examTimeLeft <= 0) {
        stopExamTimer();
        showToast('考试时间到，自动交卷');
        submitExam();
      }
    }, 1000);
  }

  function stopExamTimer() {
    if (state.examTimer) {
      clearInterval(state.examTimer);
      state.examTimer = null;
    }
  }

  function updateExamTimerDisplay() {
    const el = $('exam-timer');
    if (!el) return;
    const timeLeft = state.paperMode ? state.paperSectionTimeLeft : state.examTimeLeft;
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    // 剩余不足1分钟变红
    el.classList.toggle('timer-warning', timeLeft <= 60);
  }

  function submitExam() {
    stopExamTimer();
    closePaperSectionModal();
    state.isExam = false;

    // 统计答题情况并更新全局统计
    state.questions.forEach((q, i) => {
      const ans = state.answers[i];
      if (ans && ans.selected >= 0) {
        state.stats.totalAnswered++;
        if (ans.isRight) state.stats.totalCorrect++;
      }
    });
    saveStats();

    // 首次模考成就
    unlockAchievement('first-exam');
    checkAchievements();

    // 收集错题
    if (!state.reviewMode) {
      collectWrongQuestions();
    }

    // 显示结果
    showExamResult();
  }

  function showExamResult() {
    // 结果页可能被测评结果隐藏过分数区，考试结果需要恢复显示
    const scoreBox = $('result-score-box');
    const detailBox = $('result-detail-box');
    if (scoreBox) scoreBox.style.display = '';
    if (detailBox) detailBox.style.display = '';

    const total = state.questions.length;
    const answered = state.answers.filter(a => a && a.selected >= 0).length;
    const correctCount = state.answers.filter(a => a && a.isRight).length;
    const wrongCount = answered - correctCount;
    const unanswered = total - answered;
    const rate = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    $('score-number').textContent = rate;
    $('detail-correct').textContent = correctCount;
    $('detail-wrong').textContent = wrongCount + (unanswered > 0 ? `（${unanswered}未答）` : '');
    $('detail-rate').textContent = rate + '%';

    let icon, message;
    if (rate >= 90) { icon = '🏆'; message = '优秀！考试表现非常出色！'; }
    else if (rate >= 70) { icon = '🎉'; message = '良好！还有提升空间，继续加油！'; }
    else if (rate >= 60) { icon = '💪'; message = '及格！多复习错题，争取更高分。'; }
    else { icon = '📚'; message = '需要加强练习，重点复习错题本中的题目。'; }
    $('result-icon').textContent = icon;

    if (state.paperMode && state.paperSections.length) {
      // 套卷结果：额外给出各节答对情况，方便定位薄弱分区
      const sectionLines = state.paperSections.map(section => {
        let answered = 0;
        let correct = 0;
        for (let i = section.start; i <= section.end; i++) {
          const ans = state.answers[i];
          if (ans && ans.selected >= 0) {
            answered++;
            if (ans.isRight) correct++;
          }
        }
        const unanswered = section.count - answered;
        return `${section.name}：${correct}/${section.count} 题${unanswered > 0 ? `（未答 ${unanswered}）` : ''}`;
      });
      $('result-title').textContent = '套卷考试结束';
      $('result-message').textContent =
        `${message}\n\n各节答对情况：\n${sectionLines.join('\n')}`;
      $('retry-btn').textContent = '再考一次';
    } else {
      $('result-title').textContent = '考试结束';
      $('result-message').textContent = message;
      $('retry-btn').textContent = '再刷一组';
    }

    reviewFilter = 'all';
    renderReview();
    showPage('result');
  }

  // ===== 渲染题目 =====
  function renderQuestion() {
    const q = state.questions[state.currentIndex];
    const paperSection = (state.paperMode && state.isExam)
      ? state.paperSections[state.paperSectionIndex]
      : null;
    const total = state.questions.length;
    const globalIdx = state.currentIndex + 1;
    const sectionIdx = paperSection ? state.currentIndex - paperSection.start + 1 : globalIdx;
    const sectionTotal = paperSection ? paperSection.count : total;

    // 更新进度：套卷显示本节进度，普通模式显示整组进度
    $('progress-text').textContent = paperSection
      ? `第${state.paperSectionIndex + 1}节 ${sectionIdx}/${sectionTotal}`
      : `${globalIdx} / ${total}`;
    $('progress-fill').style.width = `${(sectionIdx / Math.max(sectionTotal, 1)) * 100}%`;
    updateNavCount();

    // 考试模式：显示倒计时，隐藏跳过按钮
    $('exam-timer-bar').style.display = state.isExam ? 'flex' : 'none';
    $('skip-btn').style.display = state.isExam ? 'none' : '';
    const timerLabel = $('exam-timer-label');
    if (timerLabel) timerLabel.style.display = paperSection ? '' : 'none';

    // 套卷分节信息条
    const sectionBar = $('paper-section-bar');
    if (sectionBar) {
      if (paperSection) {
        sectionBar.style.display = 'flex';
        $('paper-section-badge').textContent =
          `第 ${state.paperSectionIndex + 1} / ${state.paperSections.length} 节`;
        $('paper-section-name').textContent = paperSection.name;
        $('paper-section-hint').textContent =
          `本节 ${paperSection.count} 题 · ${paperSection.minutes} 分钟`;
      } else {
        sectionBar.style.display = 'none';
      }
    }

    // 题目内容
    $('question-category').textContent = q.category || '选择题';
    $('question-index').textContent = paperSection
      ? `第 ${globalIdx} / ${total} 题`
      : `第 ${globalIdx} 题`;
    $('question-text').textContent = q.question;

    // 听力播放按钮：兼容 TTS 文本与音频 URL；DOM 缺失时动态兜底创建
    let audioBtn = $('audio-play-btn');
    const audioSrc = getQuestionAudio(q);
    const isListeningQ = /听力|聴解|listening/i.test(q.category || '');
    if (audioSrc) {
      if (!audioBtn) {
        audioBtn = document.createElement('button');
        audioBtn.id = 'audio-play-btn';
        audioBtn.className = 'audio-play-btn';
        audioBtn.title = '播放音频';
        audioBtn.innerHTML = '<span class="audio-icon">🔊</span><span class="audio-label">播放</span>';
        $('question-text').insertAdjacentElement('afterend', audioBtn);
      }
      audioBtn.style.display = 'inline-flex';
      audioBtn.onclick = () => playAudioSrc(audioSrc, audioBtn);
    } else if (audioBtn) {
      audioBtn.style.display = 'none';
    }
    // 换题不残留：上一题的听力继续放着、按钮还亮着「播放中」的话，用户会以为当前题在播。
    // 听力考试的场景尤其明显（翻到下一题时前一题的录音还没念完）。
    if (currentAudioEl || currentAudioKey || (audioBtn && audioBtn.classList.contains('playing'))) {
      stopCurrentAudio(audioBtn);
    }
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    // 听力题却没有音频：给出明确提示，避免用户以为题目坏了
    let audioHint = $('audio-missing-hint');
    if (isListeningQ && !audioSrc) {
      if (!audioHint) {
        audioHint = document.createElement('div');
        audioHint.id = 'audio-missing-hint';
        audioHint.className = 'audio-missing-hint';
        $('question-text').insertAdjacentElement('afterend', audioHint);
      }
      audioHint.textContent = '⚠️ 该听力题未附带音频，可参考题干原文作答';
      audioHint.style.display = 'block';
    } else if (audioHint) {
      audioHint.style.display = 'none';
    }

    // 收藏按钮状态
    const favBtn = $('favorite-btn');
    const fav = isFavorite(q);
    favBtn.textContent = fav ? '★' : '☆';
    favBtn.classList.toggle('active', fav);
    favBtn.onclick = () => {
      const nowFav = toggleFavorite(q);
      favBtn.textContent = nowFav ? '★' : '☆';
      favBtn.classList.toggle('active', nowFav);
      updateFavoritesBadge();
      showToast(nowFav ? '⭐ 已收藏' : '已取消收藏');
    };

    // 选项 / 主观题作答区
    const optionsContainer = $('options-list');
    optionsContainer.innerHTML = '';
    const currentAnswer = state.answers[state.currentIndex];

    if (isSubjective(q)) {
      // 主观题：不显示选项，改为「查看答案」+ 自评按钮
      const subjectiveArea = document.createElement('div');
      subjectiveArea.className = 'subjective-area';

      if (!currentAnswer || !currentAnswer.subjectiveViewed) {
        // 未查看答案：只显示查看答案按钮
        const viewBtn = document.createElement('button');
        viewBtn.className = 'view-answer-btn';
        viewBtn.textContent = '👀 查看答案';
        viewBtn.onclick = () => {
          renderSubjectiveAnswer(q, subjectiveArea);
        };
        subjectiveArea.appendChild(viewBtn);
      } else {
        // 已查看答案：显示参考答案 + 自评按钮
        renderSubjectiveAnswer(q, subjectiveArea);
      }

      optionsContainer.appendChild(subjectiveArea);

      // 主观题下一题按钮始终可用（练习模式）
      if (!state.isExam && !state.isAssessment) {
        nextBtn.disabled = false;
        nextBtn.textContent = state.currentIndex === total - 1 ? '查看结果' : '下一题';
      }
    } else {
      q.options.forEach((option, i) => {
        const item = document.createElement('div');
        item.className = 'option-item';
        item.dataset.index = i;
        // 考试模式/测评模式：高亮已选选项（不显示对错）
        if ((state.isExam || state.isAssessment) && currentAnswer && currentAnswer.selected === i) {
          item.classList.add('selected');
        }
        item.innerHTML = `
          <div class="option-label">${OPTION_LABELS[i]}</div>
          <div class="option-text">${option}</div>
        `;
        item.addEventListener('click', () => selectOption(i));
        optionsContainer.appendChild(item);
      });
    }

    // 隐藏答案解析（考试模式始终隐藏；主观题已在上方单独处理）
    if (state.isExam) {
      $('answer-result').style.display = 'none';
    } else if (!isSubjective(q)) {
      $('answer-result').style.display = 'none';
    }

    // 更新按钮状态
    $('prev-btn').disabled = state.currentIndex === 0;
    const nextBtn = $('next-btn');

    if (paperSection) {
      // 套卷：只能在本节内前后翻页；本节最后一题进入下一节/交卷
      const atSectionEnd = state.currentIndex >= paperSection.end;
      const isLastSection = state.paperSectionIndex >= state.paperSections.length - 1;
      $('prev-btn').disabled = state.currentIndex <= paperSection.start;
      nextBtn.disabled = false;
      nextBtn.textContent = atSectionEnd
        ? (isLastSection ? '交卷' : '进入下一节')
        : '下一题';
    } else if (state.isAssessment) {
      // 测评模式：选过即可翻页，最后一题显示"查看结果"
      nextBtn.disabled = !currentAnswer;
      nextBtn.textContent = state.currentIndex === total - 1 ? '查看结果' : '下一题';
    } else if (state.isExam) {
      // 考试模式：始终可翻页，最后一题显示"交卷"
      nextBtn.disabled = false;
      nextBtn.textContent = state.currentIndex === total - 1 ? '交卷' : '下一题';
    } else {
      if (currentAnswer) {
        showAnswerResult(currentAnswer.selected, currentAnswer.isRight);
        nextBtn.textContent = state.currentIndex === total - 1 ? '查看结果' : '下一题';
        nextBtn.disabled = false;
      } else {
        nextBtn.textContent = '下一题';
        nextBtn.disabled = true;
      }
      if (state.currentIndex === total - 1 && currentAnswer) {
        nextBtn.textContent = '查看结果';
      }
    }
  }

  // ===== 选择选项 =====
  function selectOption(index) {
    const q = state.questions[state.currentIndex];

    // 测评模式：无对错，记录所选标签，不高亮红绿、不计分不触发连击
    if (state.isAssessment) {
      const isNewAnswer = !state.answers[state.currentIndex];
      state.answers[state.currentIndex] = {
        questionId: q.id,
        selected: index,
        tag: (q.optionResults || [])[index] || ''
      };
      // 实时缓存进度（返回键退出后可继续测试）
      saveAssessmentDraft(state.selectedSubject, {
        answers: state.answers, currentIndex: state.currentIndex, questions: state.questions
      });
      document.querySelectorAll('.option-item').forEach((item, i) => {
        item.classList.toggle('selected', i === index);
      });
      // 首次作答：短暂高亮后自动进入下一题（回看修改答案时不自动跳）
      if (isNewAnswer) {
        setTimeout(() => {
          if (currentPage !== 'quiz' || !state.isAssessment) return;
          if (state.currentIndex < state.questions.length - 1) {
            goToQuestion(state.currentIndex + 1);
          } else {
            showResult();
          }
        }, 400);
        return;
      }
      const nextBtn = $('next-btn');
      nextBtn.disabled = false;
      if (state.currentIndex === state.questions.length - 1) {
        nextBtn.textContent = '查看结果';
      }
      return;
    }

    if (state.isExam) {
      // 考试模式：允许改选，不即时判分
      state.answers[state.currentIndex] = {
        questionId: q.id,
        selected: index,
        correct: q.answer,
        isRight: index === q.answer
      };
      // 更新选中高亮
      document.querySelectorAll('.option-item').forEach((item, i) => {
        item.classList.toggle('selected', i === index);
      });
      return;
    }

    // 练习模式：已答过不允许重复选择
    if (state.answers[state.currentIndex]) return;

    const isRight = index === q.answer;

    // 记录答案
    state.answers[state.currentIndex] = {
      questionId: q.id,
      selected: index,
      correct: q.answer,
      isRight: isRight
    };

    // 更新全局统计
    state.stats.totalAnswered++;
    if (isRight) state.stats.totalCorrect++;
    saveStats();

    // 记录学习日志 + 已答科目
    logStudy();
    state.answeredSubjects[state.selectedSubject] = true;

    // 连击 + XP + 音效
    if (isRight) {
      state.combo++;
      const comboBonus = Math.floor(state.combo / 3) * 2;
      const xpGain = 10 + comboBonus;
      const leveledUp = addXp(xpGain);
      sfx.correct();
      showComboEffect(state.combo, xpGain);
      if (leveledUp) {
        sfx.levelUp();
        showLevelUpToast();
      }
    } else {
      state.combo = 0;
      sfx.wrong();
    }

    // 检查成就解锁
    checkAchievements();

    // 显示结果
    showAnswerResult(index, isRight);

    // 启用下一题按钮
    const nextBtn = $('next-btn');
    nextBtn.disabled = false;
    if (state.currentIndex === state.questions.length - 1) {
      nextBtn.textContent = '查看结果';
    }
  }

  // ===== 连击特效 =====
  function showComboEffect(combo, xp) {
    if (combo < 2) return;
    const el = document.createElement('div');
    el.className = 'combo-popup';
    el.textContent = combo >= 10 ? `🔥 ${combo} 连击! +${xp}XP` : `✨ ${combo} 连击 +${xp}XP`;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(-15px) scale(1.05)'; }, 10);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(-30px) scale(0.9)'; }, 900);
    setTimeout(() => el.remove(), 1500);
  }

  function showLevelUpToast() {
    const el = document.createElement('div');
    el.className = 'levelup-toast';
    el.innerHTML = `🎉 升级啦！<br>当前等级：Lv.${state.level}`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 500); }, 2500);
  }

  // ===== 显示答题结果 =====
  function showAnswerResult(selectedIndex, isRight) {
    const q = state.questions[state.currentIndex];
    const options = document.querySelectorAll('.option-item');

    options.forEach((item, i) => {
      item.classList.add('disabled');
      if (i === q.answer) {
        item.classList.add('correct');
      } else if (i === selectedIndex && !isRight) {
        item.classList.add('wrong');
      }
    });

    const resultEl = $('answer-result');
    resultEl.style.display = 'block';
    resultEl.className = 'answer-result ' + (isRight ? 'correct' : 'wrong');

    $('result-header').innerHTML = isRight
      ? '<span>✓</span><span>回答正确！</span>'
      : `<span>✗</span><span>回答错误，正确答案是 ${OPTION_LABELS[q.answer]}</span>`;

    $('result-explanation').textContent = q.explanation || '暂无解析';
  }

  // ===== 上一题 / 下一题 =====
  function goToQuestion(index) {
    state.currentIndex = index;
    renderQuestion();
  }

  // ===== 题目总览（按题型分组的题号盘）=====
  // 套卷常有 30+ 题、四五种题型，只有「上一题/下一题」时想回头检查选择题得一路点回去。
  // 这里给一个号盘：按题型（套卷考试时按节）分组，标注已答/未答/当前/收藏，点题号直达。
  function isAnsweredAt(i) {
    const a = state.answers[i];
    if (!a) return false;
    if (a.subjective) return a.selected === -2 || a.subjectiveViewed === true;
    return typeof a.selected === 'number' && a.selected >= 0;
  }

  // 套卷考试模式按「节」分组（每节独立计时，跨节跳题会破坏时限，所以上下文的节锁住）；
  // 其余模式（练习、套卷练习、普通考试）按题目的 category 分组，可自由跳转。
  function buildNavGroups() {
    const bySection = !!(state.paperMode && state.isExam && state.paperSections.length);
    const groups = [];
    const indexByKey = new Map();

    function pushGroup(label, sub) {
      const g = { label: label, sub: sub || '', items: [] };
      groups.push(g);
      return g;
    }

    state.questions.forEach(function (q, i) {
      let g;
      if (bySection) {
        const sec = state.paperSections.find(s => i >= s.start && i <= s.end)
          || state.paperSections[state.paperSections.length - 1];
        const key = sec ? sec.name : '全部';
        g = indexByKey.get(key);
        if (!g) {
          g = pushGroup(key, sec ? `第 ${sec.start + 1}–${sec.end + 1} 题` : '');
          indexByKey.set(key, g);
        }
      } else {
        const key = q.category || '未分类';
        g = indexByKey.get(key);
        if (!g) {
          g = pushGroup(key, '');
          indexByKey.set(key, g);
        }
      }
      g.items.push(i);
    });

    const curSection = bySection ? state.paperSections[state.paperSectionIndex] : null;
    groups.forEach(function (g) {
      g.locked = bySection && curSection
        ? !(g.items[0] >= curSection.start && g.items[0] <= curSection.end)
        : false;
      g.answered = g.items.filter(isAnsweredAt).length;
    });
    return groups;
  }

  function navCellHtml(i, opts) {
    const q = state.questions[i];
    const answered = isAnsweredAt(i);
    const current = !opts.review && i === state.currentIndex;
    const locked = !!(opts.locked);
    const fav = !opts.review && isFavorite(q);
    const cls = ['nav-cell'];
    if (answered) cls.push('answered');
    if (current) cls.push('current');
    if (locked) cls.push('locked');
    if (fav) cls.push('fav');
    const attrs = ['class="' + cls.join(' ') + '"', 'data-q-index="' + i + '"'];
    if (fav) attrs.push('title="已收藏"');
    if (locked) attrs.push('title="本卷按节计时，此节不可跳转"');
    return '<button type="button" ' + attrs.join(' ') + '>' + (i + 1) + '</button>';
  }

  function navGroupsHtml(groups, opts) {
    opts = opts || {};
    return groups.map(function (g) {
      return '<div class="nav-group' + (g.locked ? ' is-locked' : '') + '">'
        + '<div class="nav-group-head">'
        + '<span class="nav-group-name">' + escapeHtml(g.label) + '</span>'
        + '<span class="nav-group-meta">'
        + (g.sub ? escapeHtml(g.sub) + ' · ' : '')
        + g.items.length + ' 题 · 已答 ' + g.answered
        + (g.locked ? ' · 已锁定' : '') + '</span></div>'
        + '<div class="nav-grid">' + g.items.map(i => navCellHtml(i, {
          review: opts.review, locked: g.locked
        })).join('') + '</div></div>';
    }).join('');
  }

  function updateNavCount() {
    const el = $('question-nav-count');
    if (!el) return;
    const done = state.answers.filter((a, i) => isAnsweredAt(i)).length;
    el.textContent = done + '/' + state.questions.length;
  }

  function openQuestionNav() {
    if (!state.questions.length) return;
    const groups = buildNavGroups();
    const bySection = !!(state.paperMode && state.isExam && state.paperSections.length);
    const done = state.answers.filter((a, i) => isAnsweredAt(i)).length;
    const blank = state.questions.length - done;

    $('nav-summary').textContent = '共 ' + state.questions.length + ' 题 · 已答 ' + done
      + ' · 未答 ' + blank;
    $('nav-groups').innerHTML = navGroupsHtml(groups);
    const note = $('nav-note');
    if (bySection) {
      note.style.display = 'block';
      note.textContent = '套卷考试每节单独计时，只能在本节内自由跳转；已结束的节可交卷后在「答题回顾」里查看。';
    } else {
      note.style.display = 'none';
    }
    $('question-nav-modal').style.display = 'flex';
  }

  function closeQuestionNav() {
    const m = $('question-nav-modal');
    if (m) m.style.display = 'none';
  }

  function bindQuestionNav() {
    const btn = $('question-nav-btn');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.onclick = openQuestionNav;
    }
    const close = $('nav-close-btn');
    if (close && !close.dataset.bound) {
      close.dataset.bound = '1';
      close.onclick = closeQuestionNav;
    }
    const overlay = $('question-nav-modal');
    if (overlay && !overlay.dataset.bound) {
      overlay.dataset.bound = '1';
      overlay.onclick = function (e) { if (e.target === overlay) closeQuestionNav(); };
    }
    const groups = $('nav-groups');
    if (groups && !groups.dataset.bound) {
      groups.dataset.bound = '1';
      groups.onclick = function (e) {
        const cell = e.target.closest('.nav-cell');
        if (!cell) return;
        if (cell.classList.contains('locked')) {
          showToast('本卷按节计时，这一节当前不可跳转');
          return;
        }
        const idx = parseInt(cell.dataset.qIndex, 10);
        if (Number.isInteger(idx)) {
          closeQuestionNav();
          goToQuestion(idx);
        }
      };
    }
  }

  // 交卷后回顾页同款号盘：点击滚动定位到那道题
  function renderReviewNav() {
    const box = $('review-nav');
    if (!box) return;
    if (state.questions.length < 6) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';
    box.innerHTML = navGroupsHtml(buildNavGroups(), { review: true });
    if (!box.dataset.bound) {
      box.dataset.bound = '1';
      box.onclick = function (e) {
        const cell = e.target.closest('.nav-cell');
        if (!cell) return;
        const idx = parseInt(cell.dataset.qIndex, 10);
        if (!Number.isInteger(idx)) return;
        // 「只看错题」下正确题不在列表里，先切回全部再定位
        if (reviewFilter !== 'all') setReviewFilter('all');
        const target = $('review-list').querySelector('[data-q-index="' + idx + '"]');
        if (!target) { showToast('没找到第 ' + (idx + 1) + ' 题'); return; }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('nav-flash');
        setTimeout(() => target.classList.remove('nav-flash'), 1200);
      };
    }
  }

  // ===== 跳过 =====
  function skipQuestion() {
    const q = state.questions[state.currentIndex];
    // 记录为未答
    if (!state.answers[state.currentIndex]) {
      state.answers[state.currentIndex] = {
        questionId: q.id,
        selected: -1,
        correct: q.answer,
        isRight: false
      };
    }

    if (state.currentIndex < state.questions.length - 1) {
      goToQuestion(state.currentIndex + 1);
    } else {
      showResult();
    }
  }

  // ===== 显示结果 =====
  function showResult() {
    if (state.isAssessment) {
      showAssessmentResult();
      return;
    }
    // 恢复测评模式隐藏的分数区（同一会话可能先做过测评）
    const scoreBox = $('result-score-box');
    const detailBox = $('result-detail-box');
    if (scoreBox) scoreBox.style.display = '';
    if (detailBox) detailBox.style.display = '';
    // 测评分析区不用在这里清：showPage('result') 进页时统一清空
    $('retry-btn').textContent = state.paperPracticeMode ? '再练一次' : '再刷一组';
    const total = state.questions.length;
    // 分离客观题和主观题统计
    const objectiveAnswers = state.answers.filter((a, i) => a && !isSubjective(state.questions[i]));
    const subjectiveAnswers = state.answers.filter((a, i) => a && isSubjective(state.questions[i]));
    const correctCount = objectiveAnswers.filter(a => a.isRight).length;
    const wrongCount = objectiveAnswers.length - correctCount;
    const rate = objectiveAnswers.length > 0 ? Math.round((correctCount / objectiveAnswers.length) * 100) : 0;
    const score = rate;
    const subjectiveMastered = subjectiveAnswers.filter(a => a.isRight).length;
    const subjectiveNeedsPractice = subjectiveAnswers.length - subjectiveMastered;

    $('score-number').textContent = score;
    $('detail-correct').textContent = correctCount + (subjectiveAnswers.length ? `（+${subjectiveMastered}主观）` : '');
    $('detail-wrong').textContent = wrongCount + (subjectiveAnswers.length ? `（+${subjectiveNeedsPractice}主观）` : '');
    $('detail-rate').textContent = rate + '%';

    // 图标和消息
    let icon, message;
    if (rate >= 90) {
      icon = '🏆';
      message = '太棒了！你已经掌握得非常好了，继续保持！';
    } else if (rate >= 70) {
      icon = '🎉';
      message = '做得不错！再多多练习，争取更高的正确率！';
    } else if (rate >= 50) {
      icon = '💪';
      message = '还需要加油哦，多刷几组题巩固一下吧！';
    } else {
      icon = '📚';
      message = '别灰心，错题是最好的老师，多看解析再试一次！';
    }
    $('result-icon').textContent = icon;
    $('result-title').textContent = state.paperPracticeMode
      ? (rate >= 60 ? '套卷练习完成！' : '套卷练习结束')
      : (rate >= 60 ? '刷题完成！' : '继续努力！');
    $('result-message').textContent = message;

    // 答题回顾（展示全部题目与详解，可筛选只看错题）
    reviewFilter = 'all';
    renderReview();

    // 收集错题到错题本（错题再练模式下不重复收集）
    if (!state.reviewMode) {
      collectWrongQuestions();
    }

    showPage('result');
  }

  // ===== 测评型题库的结果计算与展示（MBTI / 职业方向等，无对错） =====
  function showAssessmentResult() {
    const subject = window.QUIZ_DATA[state.selectedSubject] || {};
    const results = subject.results || [];
    const dimensions = subject.dimensions || [];
    const mode = subject.resultMode || 'combine';

    // 统计每个标签的票数
    const tally = {};
    let answeredCount = 0;
    state.answers.forEach(a => {
      if (a && a.tag) {
        tally[a.tag] = (tally[a.tag] || 0) + 1;
        answeredCount++;
      }
    });

    // 依模式得出结果 key：
    // combine = 每个维度组内取得票最高的标签，按组顺序拼接（如 MBTI 的 "INTJ"）
    // top     = 全部标签中得票最高者（如职业兴趣、性格色彩）
    let key = '';
    const argmax = (tags) => tags.reduce((best, t) => ((tally[t] || 0) > (tally[best] || 0) ? t : best), tags[0]);
    if (mode === 'top' && dimensions.length) {
      key = argmax(dimensions[0]);
    } else {
      key = dimensions.map(group => argmax(group)).join('');
    }

    const hit = results.find(r => r.key === key) || results.find(r => r.key.startsWith(key)) ||
                results.find(r => key.startsWith(r.key)) || results[0] || { key, title: key, icon: '🎯', description: '' };

    // 保存历史结果（供首页「查看测试结果」），并清掉进行中的进度缓存
    const answeredCount2 = state.answers.filter(a => a && a.tag).length;
    saveAssessmentResult(state.selectedSubject, {
      key: hit.key, icon: hit.icon || '🎯', title: hit.title || hit.key,
      description: hit.description || '',
      answeredCount: answeredCount2, total: state.questions.length,
      finishedAt: Date.now()
    });
    clearAssessmentDraft(state.selectedSubject);

    // 复用结果页：隐藏分数/正确率与答题回顾，展示测评结论
    const scoreBox = $('result-score-box');
    const detailBox = $('result-detail-box');
    if (scoreBox) scoreBox.style.display = 'none';
    if (detailBox) detailBox.style.display = 'none';
    $('review-section').style.display = 'none';
    $('result-icon').textContent = hit.icon || '🎯';
    $('result-title').textContent = hit.title || hit.key;
    $('result-message').textContent =
      `已作答 ${answeredCount2}/${state.questions.length} 题 · 结果类型：${hit.key}\n\n${hit.description || ''}`;
    $('retry-btn').textContent = '重新测试';

    showPage('result');
    // showPage 进页会清空分析区，所以必须在其之后填
    renderAssessmentDetail(hit);
  }

  // 测评结果详情：渲染题库里可选的分析字段（MBTI 的 traits/strengths/careers 等）
  const ASSESSMENT_DETAIL_FIELDS = [
    ['traits', '核心特质', 'chips'],
    ['strengths', '你的优势', 'chips'],
    ['blindspots', '需要注意', 'chips'],
    ['workstyle', '工作风格', 'text'],
    ['careers', '适合方向', 'chips'],
    ['relationships', '人际关系', 'text'],
    ['growth', '成长建议', 'text'],
    ['stress', '压力应对', 'text']
  ];

  function renderAssessmentDetail(hit) {
    const box = $('assessment-detail');
    if (!box) return;
    // 传 null / 空对象 = 清空并隐藏（非测评路径与进页时的默认状态都走这条）
    if (!hit || typeof hit !== 'object') {
      box.innerHTML = '';
      box.style.display = 'none';
      return;
    }
    let html = '';
    ASSESSMENT_DETAIL_FIELDS.forEach(function (field) {
      const value = hit[field[0]];
      if (!value) return;
      if (field[2] === 'chips') {
        if (!Array.isArray(value) || !value.length) return;
        html += '<div class="assess-block"><div class="assess-label">' + escapeHtml(field[1]) + '</div><div class="assess-chips">' +
          value.map(v => '<span class="assess-chip">' + escapeHtml(String(v)) + '</span>').join('') + '</div></div>';
      } else {
        if (typeof value !== 'string' || !value.trim()) return;
        html += '<div class="assess-block"><div class="assess-label">' + escapeHtml(field[1]) +
          '</div><div class="assess-text">' + escapeHtml(value) + '</div></div>';
      }
    });
    box.innerHTML = html;
    box.style.display = html ? 'block' : 'none';
  }

  // 答题回顾筛选：'all' = 全部题目，'wrong' = 只看错题
  let reviewFilter = 'all';

  function renderReview() {
    const reviewSection = $('review-section');
    const reviewList = $('review-list');

    // 没有任何答题记录就不显示
    if (!state.answers.some(a => a)) {
      reviewSection.style.display = 'none';
      return;
    }
    reviewSection.style.display = 'block';

    const wrongCount = state.questions.filter((q, i) => state.answers[i] && !state.answers[i].isRight).length;
    const totalCount = state.questions.length;

    reviewList.innerHTML = state.questions
      .map((q, i) => ({ q, i, ans: state.answers[i] }))
      .filter(({ ans }) => {
        if (reviewFilter === 'all') return true;
        // 只看错题：主观题 mastered=false 也算错
        if (!ans) return false;
        if (ans.subjective && ans.isRight === false) return true;
        return !ans.isRight;
      })
      .map(({ q, i, ans }) => {
        // 主观题特殊处理
        if (isSubjective(q)) {
          const isRight = !!(ans && ans.isRight);
          const statusCls = isRight ? 'correct' : 'wrong';
          const statusText = isRight ? '✓ 已掌握' : (ans ? '✗ 需巩固' : '✗ 未自评');
          const answerTextHtml = q.answerText
            ? `<div class="subjective-answer-content">${escapeHtml(String(q.answerText)).replace(/\\n/g, '<br>')}</div>`
            : '';
          const expHtml = q.explanation
            ? `<div class="review-explanation">💡 ${escapeHtml(String(q.explanation))}</div>`
            : '';
          return `
            <div class="review-item subjective ${statusCls}" data-q-index="${i}">
              <div class="review-question">${i + 1}. [主观题] ${escapeHtml(String(q.question))}</div>
              <div class="review-answer">
                <span class="${isRight ? 'correct-answer' : 'wrong-answer'}">${statusText}</span>
              </div>
              ${answerTextHtml}
              ${expHtml}
            </div>`;
        }

        const correctIdx = ans ? ans.correct : q.answer;
        const isRight = !!(ans && ans.isRight);
        const unanswered = !ans || ans.selected < 0;
        const statusCls = isRight ? 'correct' : 'wrong';
        const statusText = isRight ? '✓ 回答正确' : (unanswered ? '✗ 未作答' : '✗ 回答错误');
        const userLabel = (!ans || ans.selected < 0) ? '' : ans.selected;

        const optionsHtml = (q.options || []).map((opt, oi) => {
          const escOpt = escapeHtml(String(opt));
          if (oi === correctIdx) {
            return `<div class="review-option correct">${OPTION_LABELS[oi]}. ${escOpt} ✓正确答案</div>`;
          }
          if (!unanswered && oi === userLabel && !isRight) {
            return `<div class="review-option user-wrong">${OPTION_LABELS[oi]}. ${escOpt} ✗你的选择</div>`;
          }
          return `<div class="review-option">${OPTION_LABELS[oi]}. ${escOpt}</div>`;
        }).join('');

        const expHtml = q.explanation
          ? `<div class="review-explanation">💡 ${escapeHtml(String(q.explanation))}</div>`
          : '';
        // 听力题在回顾里补一个重播按钮，方便复盘
        const reviewAudio = getQuestionAudio(q);
        const audioHtml = reviewAudio
          ? `<button type="button" class="review-audio-btn" data-audio-index="${i}">
               <span class="audio-icon">🔊</span><span class="audio-label">播放听力</span>
             </button>`
          : '';

        return `
          <div class="review-item ${statusCls}" data-q-index="${i}">
            <div class="review-question">${i + 1}. ${escapeHtml(String(q.question))}</div>
            ${audioHtml}
            <div class="review-answer">
              ${isRight
                ? `<span class="correct-answer">${statusText}</span>`
                : `<span class="wrong-answer">${statusText}</span>${!unanswered ? ` ｜ 你的选择：${OPTION_LABELS[userLabel]}` : ''} ｜ 正确答案：${OPTION_LABELS[correctIdx]}`}
            </div>
            <div class="review-options">${optionsHtml}</div>
            ${expHtml}
          </div>`;
      }).join('');

    // 回顾中的听力重播
    reviewList.querySelectorAll('.review-audio-btn').forEach(btn => {
      const idx = Number(btn.dataset.audioIndex);
      const q = state.questions[idx];
      const audioSrc = getQuestionAudio(q);
      if (!audioSrc) return;
      btn.addEventListener('click', () => playAudioSrc(audioSrc, btn));
    });

    // 更新筛选条状态
    const chips = reviewSection.querySelectorAll('.review-filter');
    chips.forEach(c => {
      c.classList.toggle('active', c.dataset.filter === reviewFilter);
      if (c.dataset.filter === 'wrong') {
        c.textContent = `只看错题（${wrongCount}）`;
      } else {
        c.textContent = `全部（${totalCount}）`;
      }
    });

    renderReviewNav();
  }

  // 号盘跳转时可能要先切换筛选，保证目标题一定在 DOM 里
  function setReviewFilter(name) {
    reviewFilter = name;
    renderReview();
  }

  // ===== 事件绑定 =====
  function bindQuizEvents() {
    $('quiz-back-btn').addEventListener('click', () => {
      if (state.isExam) {
        if (!confirm('确定要交卷并退出考试吗？')) return;
        submitExam();
        return;
      }
      if (confirm('确定要退出本次刷题吗？进度将不会保存。')) {
        cleanupQuizSession();
        showPage('home');
        updateStatsUI();
        checkStartButton();
      }
    });

    $('skip-btn').addEventListener('click', skipQuestion);

    $('prev-btn').addEventListener('click', () => {
      if (state.paperMode && state.isExam) {
        const section = state.paperSections[state.paperSectionIndex];
        if (section && state.currentIndex > section.start) {
          goToQuestion(state.currentIndex - 1);
        }
        return;
      }
      if (state.currentIndex > 0) {
        goToQuestion(state.currentIndex - 1);
      }
    });

    $('next-btn').addEventListener('click', () => {
      // 套卷：翻页限制在本节内，节点末尾进入下一节或交卷
      if (state.paperMode && state.isExam) {
        handlePaperNext();
        return;
      }
      if (state.currentIndex < state.questions.length - 1) {
        goToQuestion(state.currentIndex + 1);
      } else {
        if (state.isExam) {
          submitExam();
        } else {
          showResult();
        }
      }
    });
  }

  function bindResultEvents() {
    $('retry-btn').addEventListener('click', () => {
      if (state.paperMode) {
        startPaperExam();
        return;
      }
      if (state.paperPracticeMode) {
        startPaperPractice();
        return;
      }
      startQuiz();
    });

    $('home-btn').addEventListener('click', () => {
      cleanupQuizSession();
      showPage('home');
      updateStatsUI();
      checkStartButton();
    });

    // 答题回顾筛选：全部 / 只看错题
    document.querySelectorAll('#review-section .review-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        reviewFilter = btn.dataset.filter;
        renderReview();
      });
    });
  }

  // 清理本次答题会话状态
  function cleanupQuizSession() {
    stopExamTimer();
    closePaperSectionModal();
    state.isExam = false;
    state.examTimeLeft = 0;
    state.paperMode = false;
    state.paperPracticeMode = false;
    state.paperSections = [];
    state.paperSectionIndex = 0;
    state.paperSectionTimeLeft = 0;
    if (state.reviewMode) {
      state.reviewMode = false;
      delete window.QUIZ_DATA['__wrongbook_review__'];
      state.selectedSubject = null;
      checkStartButton();
    }
  }

  // ===== 导入题库功能 =====

  // 加载已导入的题库：优先 IndexedDB；旧版本数据在 localStorage 里的会自动迁移过去
  async function loadImportedBanks() {
    try {
      let banks = null;
      try {
        banks = await idbGet(IDB_IMPORTED_KEY);
      } catch (e) {
        console.warn('IndexedDB 读取失败，退回 localStorage', e);
      }
      if (!banks) {
        const saved = localStorage.getItem(IMPORTED_STORAGE_KEY);
        if (saved) {
          banks = JSON.parse(saved);
          // 迁移到 IndexedDB，成功后清掉 localStorage 里的旧数据腾出配额
          idbSet(IDB_IMPORTED_KEY, banks).then(() => {
            try { localStorage.removeItem(IMPORTED_STORAGE_KEY); } catch (e) {}
            console.info('已导入题库迁移至 IndexedDB 完成');
          }).catch(e => console.warn('迁移导入题库失败', e));
        }
      }
      if (banks && typeof banks === 'object') {
        Object.entries(banks).forEach(([key, bank]) => {
          if (bank && Array.isArray(bank.questions)) {
            window.QUIZ_DATA = window.QUIZ_DATA || {};
            window.QUIZ_DATA[key] = bank;
            state.importedKeys[key] = true;
          }
        });
      }
    } catch (e) {
      console.warn('加载导入题库失败', e);
    }
  }

  // 保存已导入的题库到 IndexedDB（异步，不阻塞导入流程）
  function saveImportedBanks() {
    const banks = {};
    Object.keys(state.importedKeys).forEach(key => {
      if (window.QUIZ_DATA[key]) {
        banks[key] = window.QUIZ_DATA[key];
      }
    });
    idbSet(IDB_IMPORTED_KEY, banks).catch(e => {
      console.warn('保存导入题库失败', e);
      showToast('保存失败，存储空间可能不足');
    });
  }

  // 校验配置文件格式
  function validateBankConfig(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: '配置文件格式不正确' };
    }
    if (!data.key || typeof data.key !== 'string') {
      return { valid: false, error: '缺少 key 字段（题库唯一标识）' };
    }
    if (!data.name || typeof data.name !== 'string') {
      return { valid: false, error: '缺少 name 字段（题库名称）' };
    }
    if (!Array.isArray(data.questions)) {
      return { valid: false, error: 'questions 必须是数组' };
    }
    if (data.questions.length === 0) {
      return { valid: false, error: '题库为空，至少需要一道题' };
    }
    // 听力音频的在线地址前缀（v1.8.0 起音频不随 APK 打包，播放时按这个前缀取）
    if (data.audioBase !== undefined && data.audioBase !== null) {
      if (typeof data.audioBase !== 'string' || !/^(https?:)?\/\//i.test(data.audioBase.trim())) {
        return { valid: false, error: 'audioBase 必须是以 http(s):// 开头的音频地址前缀' };
      }
      if (data.audioIds !== undefined && !Array.isArray(data.audioIds)) {
        return { valid: false, error: 'audioIds 必须是题号数组' };
      }
      if (data.audioRange !== undefined
          && (!Array.isArray(data.audioRange) || data.audioRange.length !== 2
              || data.audioRange.some(n => !Number.isInteger(Number(n))))) {
        return { valid: false, error: 'audioRange 必须是 [起始题号, 结束题号] 两个整数' };
      }
    }
    // 测评型题库：无对错，按选项映射的标签计分出结果
    if (data.type === 'assessment') {
      if (!Array.isArray(data.results) || data.results.length === 0) {
        return { valid: false, error: '测评题库缺少 results（结果列表）' };
      }
      for (const r of data.results) {
        if (!r.key || !r.title) {
          return { valid: false, error: 'results 中每项需要 key 和 title 字段' };
        }
      }
      for (let i = 0; i < data.questions.length; i++) {
        const q = data.questions[i];
        if (!q.question || !Array.isArray(q.options) || q.options.length < 2) {
          return { valid: false, error: `第 ${i + 1} 题格式错误：缺少题干或选项不足` };
        }
        if (!Array.isArray(q.optionResults) || q.optionResults.length !== q.options.length ||
            q.optionResults.some(t => !t || typeof t !== 'string')) {
          return { valid: false, error: `第 ${i + 1} 题缺少 optionResults（每个选项对应的结果标签，数量需与选项一致）` };
        }
      }
      return { valid: true };
    }
    // 校验每道题
    for (let i = 0; i < data.questions.length; i++) {
      const q = data.questions[i];
      if (!q.question) {
        return { valid: false, error: `第 ${i + 1} 题缺少题干` };
      }
      // 主观题：允许无选项，但必须有 answerText
      if (q.subjective === true || ((!Array.isArray(q.options) || q.options.length === 0) && (q.answerText || q.explanation))) {
        if (!q.answerText && !q.explanation) {
          return { valid: false, error: `第 ${i + 1} 题是主观题，需要填写 answerText 或 explanation` };
        }
        continue;
      }
      // 客观题：必须有选项和合法答案
      if (!Array.isArray(q.options) || q.options.length < 2) {
        return { valid: false, error: `第 ${i + 1} 题格式错误：缺少题干或选项不足` };
      }
      if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) {
        return { valid: false, error: `第 ${i + 1} 题答案索引无效` };
      }
    }
    return { valid: true };
  }

  // 处理文件导入
  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const validation = validateBankConfig(data);
        if (!validation.valid) {
          showResultModal(false, '配置文件校验失败：' + validation.error);
          return;
        }
        processImport(data);
      } catch (err) {
        showResultModal(false, 'JSON 解析失败，请检查文件格式是否正确');
        console.error(err);
      }
    };
    reader.onerror = () => {
      showResultModal(false, '文件读取失败，请重试');
    };
    reader.readAsText(file, 'UTF-8');
  }

  // 处理导入逻辑（检测冲突）
  function processImport(data) {
    const existing = window.QUIZ_DATA[data.key];
    if (existing) {
      // 题库已存在，询问用户覆盖还是追加
      state.pendingImport = data;
      showConflictModal(existing, data);
    } else {
      // 新题库，直接添加
      addBank(data);
      saveImportedBanks();
      renderSubjectList();
      showResultModal(true, `成功导入题库"${data.name}"，共 ${data.questions.length} 道题`);
    }
  }

  // 添加题库（新题库）
  function addBank(data) {
    window.QUIZ_DATA = window.QUIZ_DATA || {};
    // 规范化题目：补充 id
    const questions = data.questions.map((q, i) => ({
      ...q,
      id: q.id || (i + 1)
    }));
    window.QUIZ_DATA[data.key] = {
      name: data.name,
      icon: data.icon || '📝',
      description: data.description || '自定义导入题库',
      category: data.category || 'custom',
      questions: questions
    };
    // 套卷元数据（题量/时长/分区/保序）：原样保留，模拟考试时自动预填
    if (data.exam && typeof data.exam === 'object') {
      window.QUIZ_DATA[data.key].exam = data.exam;
    }
    // 听力音频在线地址：只有 addBank 认的顶层字段才会被保留，不透传就等于丢
    if (typeof data.audioBase === 'string' && data.audioBase.trim()) {
      const bank = window.QUIZ_DATA[data.key];
      bank.audioBase = data.audioBase.trim();
      if (Array.isArray(data.audioIds)) bank.audioIds = data.audioIds.map(Number).filter(Number.isInteger);
      if (Array.isArray(data.audioRange) && data.audioRange.length === 2) bank.audioRange = data.audioRange.map(Number);
      if (typeof data.audioExt === 'string' && /^\.[a-z0-9]+$/i.test(data.audioExt)) bank.audioExt = data.audioExt.toLowerCase();
    }
    // 测评型题库：透传计分所需字段
    if (data.type === 'assessment') {
      window.QUIZ_DATA[data.key].type = 'assessment';
      window.QUIZ_DATA[data.key].resultMode = data.resultMode || 'combine';
      window.QUIZ_DATA[data.key].results = data.results || [];
      window.QUIZ_DATA[data.key].dimensions = data.dimensions || [];
    }
    state.importedKeys[data.key] = true;
    // 重新导入要能覆盖「彻底删除」的标记：hideDeletedBanks() 是无条件按 hiddenKeys 移除的，
    // 不清掉的话，用户从传送门找回题库时看着导入成功，重启 App 又消失了（内置题库删除后线上找回是唯一通道）。
    if (state.hiddenKeys[data.key]) {
      delete state.hiddenKeys[data.key];
      saveRecycleBin();
    }
  }

  // 应用导入（覆盖或追加）
  function applyImport(mode) {
    const data = state.pendingImport;
    if (!data) return;

    if (mode === 'overwrite') {
      // 覆盖：替换现有题库
      addBank(data);
      showResultModal(true, `已覆盖题库"${data.name}"，共 ${data.questions.length} 道题`);
    } else if (mode === 'append') {
      // 追加：合并题目，重新编号
      const existing = window.QUIZ_DATA[data.key];
      const maxId = existing.questions.reduce((max, q) => Math.max(max, q.id || 0), 0);
      const newQuestions = data.questions.map((q, i) => ({
        ...q,
        id: maxId + i + 1
      }));
      existing.questions = existing.questions.concat(newQuestions);
      // 更新元信息（如果新文件提供了）
      if (data.name) existing.name = data.name;
      if (data.icon) existing.icon = data.icon;
      if (data.description) existing.description = data.description;
      state.importedKeys[data.key] = true;
      showResultModal(true, `已追加 ${newQuestions.length} 道题到"${existing.name}"，当前共 ${existing.questions.length} 道题`);
    }

    saveImportedBanks();
    renderSubjectList();
    state.pendingImport = null;
    closeConflictModal();
  }

  // ===== 回收站功能 =====

  // 加载回收站数据
  function loadRecycleBin() {
    try {
      const rb = localStorage.getItem(RECYCLE_BIN_STORAGE);
      if (rb) state.recycleBin = JSON.parse(rb) || {};
      const hk = localStorage.getItem(HIDDEN_KEYS_STORAGE);
      if (hk) state.hiddenKeys = JSON.parse(hk) || {};
    } catch (e) {
      console.warn('加载回收站失败', e);
    }
  }

  // 保存回收站数据
  function saveRecycleBin() {
    try {
      localStorage.setItem(RECYCLE_BIN_STORAGE, JSON.stringify(state.recycleBin));
      localStorage.setItem(HIDDEN_KEYS_STORAGE, JSON.stringify(state.hiddenKeys));
    } catch (e) {
      console.warn('保存回收站失败', e);
    }
  }

  // 隐藏已删除/已隐藏的题库（在数据加载完成后调用）
  function hideDeletedBanks() {
    // 回收站中的题库：从主列表移除，内置题库需备份数据
    Object.keys(state.recycleBin).forEach(key => {
      if (window.QUIZ_DATA[key]) {
        // 备份内置题库数据（导入题库的数据已在 recycleBin 中）
        if (!state.importedKeys[key]) {
          state.recycleBin[key] = { ...window.QUIZ_DATA[key], _deletedAt: Date.now() };
        }
      }
      delete window.QUIZ_DATA[key];
    });
    // 已彻底隐藏的题库：直接从主列表移除，不备份
    Object.keys(state.hiddenKeys).forEach(key => {
      delete window.QUIZ_DATA[key];
    });
  }

  // 将题库移入回收站
  function moveToRecycleBin(key) {
    const bank = window.QUIZ_DATA[key];
    if (!bank) return;
    if (!confirm(`确定将"${bank.name}"移入回收站吗？可在回收站中恢复。`)) return;

    // 备份完整数据到回收站
    state.recycleBin[key] = { ...bank, _deletedAt: Date.now() };

    delete window.QUIZ_DATA[key];

    if (state.selectedSubject === key) {
      state.selectedSubject = null;
      checkStartButton();
    }

    saveRecycleBin();
    renderSubjectList();
    updateRecycleBinBadge();
    showToast(`"${bank.name}" 已移入回收站`);
  }

  // 从回收站恢复题库
  function restoreFromRecycleBin(key) {
    const bank = state.recycleBin[key];
    if (!bank) return;

    const { _deletedAt, ...bankData } = bank;
    window.QUIZ_DATA = window.QUIZ_DATA || {};
    window.QUIZ_DATA[key] = bankData;

    delete state.recycleBin[key];

    saveRecycleBin();
    renderSubjectList();
    renderRecycleBinList();
    updateRecycleBinBadge();
    showToast(`"${bankData.name}" 已恢复`);
  }

  // 从回收站彻底删除
  function permanentlyDelete(key) {
    const bank = state.recycleBin[key];
    const name = bank ? bank.name : key;
    if (!confirm(`确定彻底删除"${name}"吗？此操作不可恢复！`)) return;

    delete state.recycleBin[key];

    if (state.importedKeys[key]) {
      // 导入题库：从已导入存储中移除
      delete state.importedKeys[key];
      saveImportedBanks();
    } else {
      // 内置题库：标记为彻底隐藏，防止重新加载后再次出现
      state.hiddenKeys[key] = true;
    }

    // 题库都没了，留着它的听力音频只会占空间（移入回收站时不删，还要能恢复）
    purgeBankAudio(key).then(removed => {
      if (removed) showToast(`已同时清理 ${removed} 段听力音频`);
    });

    saveRecycleBin();
    renderRecycleBinList();
    updateRecycleBinBadge();
    showToast(`"${name}" 已彻底删除`);
  }

  // 清空回收站
  function emptyRecycleBin() {
    const count = Object.keys(state.recycleBin).length;
    if (count === 0) {
      showToast('回收站为空');
      return;
    }
    if (!confirm(`确定清空回收站中的 ${count} 个题库吗？此操作不可恢复！`)) return;

    Object.keys(state.recycleBin).forEach(key => {
      if (state.importedKeys[key]) {
        delete state.importedKeys[key];
      } else {
        state.hiddenKeys[key] = true;
      }
      purgeBankAudio(key);
    });
    state.recycleBin = {};

    saveRecycleBin();
    saveImportedBanks();
    renderRecycleBinList();
    updateRecycleBinBadge();
    showToast('回收站已清空，已删除题库将不再显示');
  }

  // 渲染回收站列表
  function renderRecycleBinList() {
    const container = $('recycle-list');
    if (!container) return;
    const keys = Object.keys(state.recycleBin);
    if (keys.length === 0) {
      container.innerHTML = '<div class="recycle-empty">回收站为空</div>';
      return;
    }
    container.innerHTML = '';
    keys.forEach(key => {
      const bank = state.recycleBin[key];
      const deletedAt = bank._deletedAt ? new Date(bank._deletedAt).toLocaleString('zh-CN') : '';
      const item = document.createElement('div');
      item.className = 'recycle-item';
      item.innerHTML = `
        <div class="recycle-item-icon">${bank.icon || '📝'}</div>
        <div class="recycle-item-info">
          <div class="recycle-item-name">${bank.name}</div>
          <div class="recycle-item-meta">${bank.questions ? bank.questions.length : 0} 题 · 删除于 ${deletedAt}</div>
        </div>
        <div class="recycle-item-actions">
          <button class="recycle-btn restore-btn" data-key="${key}" title="恢复">↩️ 恢复</button>
          <button class="recycle-btn destroy-btn" data-key="${key}" title="彻底删除">✕ 彻底删除</button>
        </div>
      `;
      container.appendChild(item);
    });
    // 绑定事件
    container.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', () => restoreFromRecycleBin(btn.dataset.key));
    });
    container.querySelectorAll('.destroy-btn').forEach(btn => {
      btn.addEventListener('click', () => permanentlyDelete(btn.dataset.key));
    });
  }

  // 更新回收站入口角标
  function updateRecycleBinBadge() {
    const badge = $('recycle-badge');
    if (!badge) return;
    const count = Object.keys(state.recycleBin).length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  function openRecycleBin() {
    renderRecycleBinList();
    $('recycle-modal').style.display = 'flex';
  }

  function closeRecycleBin() {
    $('recycle-modal').style.display = 'none';
  }

  // ===== 错题本功能 =====
  function wrongBookKey(subjectKey, qId) {
    return `${subjectKey}__${qId}`;
  }

  function loadWrongBook() {
    try {
      const saved = localStorage.getItem(WRONG_BOOK_STORAGE);
      if (saved) state.wrongBook = JSON.parse(saved) || {};
    } catch (e) {
      console.warn('加载错题本失败', e);
    }
  }

  function saveWrongBook() {
    try {
      localStorage.setItem(WRONG_BOOK_STORAGE, JSON.stringify(state.wrongBook));
    } catch (e) {
      console.warn('保存错题本失败', e);
    }
  }

  // 将一道错题加入错题本
  function addToWrongBook(subjectKey, q) {
    const key = wrongBookKey(subjectKey, q.id);
    if (state.wrongBook[key]) {
      state.wrongBook[key].wrongCount = (state.wrongBook[key].wrongCount || 1) + 1;
      state.wrongBook[key].lastWrongAt = Date.now();
    } else {
      state.wrongBook[key] = {
        subjectKey: subjectKey,
        id: q.id,
        question: q.question,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation || '',
        category: q.category || '',
        ...pickExtFields(q),
        wrongCount: 1,
        lastWrongAt: Date.now()
      };
    }
  }

  // 收集本次答题的所有错题
  function collectWrongQuestions() {
    if (!state.selectedSubject) return;
    state.questions.forEach((q, i) => {
      const ans = state.answers[i];
      if (!ans || !ans.isRight) {
        addToWrongBook(state.selectedSubject, q);
      }
    });
    saveWrongBook();
    updateWrongBookBadge();
  }

  function removeFromWrongBook(key) {
    delete state.wrongBook[key];
    saveWrongBook();
    renderWrongBookList();
    updateWrongBookBadge();
    showToast('已从错题本移除');
  }

  function clearWrongBook() {
    const count = Object.keys(state.wrongBook).length;
    if (count === 0) {
      showToast('错题本为空');
      return;
    }
    if (!confirm(`确定清空错题本中的 ${count} 道错题吗？`)) return;
    state.wrongBook = {};
    saveWrongBook();
    renderWrongBookList();
    updateWrongBookBadge();
    showToast('错题本已清空');
  }

  function renderWrongBookList() {
    const container = $('wrongbook-list');
    if (!container) return;
    const keys = Object.keys(state.wrongBook);
    if (keys.length === 0) {
      container.innerHTML = '<div class="recycle-empty">错题本为空，去刷题收集错题吧～</div>';
      return;
    }
    container.innerHTML = '';
    keys.forEach(key => {
      const item = state.wrongBook[key];
      const lastAt = item.lastWrongAt ? new Date(item.lastWrongAt).toLocaleString('zh-CN') : '';
      const div = document.createElement('div');
      div.className = 'recycle-item wrongbook-item';
      div.innerHTML = `
        <div class="recycle-item-icon">❌</div>
        <div class="recycle-item-info">
          <div class="recycle-item-name">${escapeHtml(item.question)}</div>
          <div class="recycle-item-meta">错过 ${item.wrongCount || 1} 次 · ${lastAt}</div>
        </div>
        <div class="recycle-item-actions">
          <button class="recycle-btn restore-btn wb-remove-btn" data-key="${key}" title="移除">✕ 移除</button>
        </div>
      `;
      container.appendChild(div);
    });
    container.querySelectorAll('.wb-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => removeFromWrongBook(btn.dataset.key));
    });
  }

  function updateWrongBookBadge() {
    const badge = $('wrongbook-badge');
    if (!badge) return;
    const count = Object.keys(state.wrongBook).length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  function openWrongBook() {
    renderWrongBookList();
    $('wrongbook-modal').style.display = 'flex';
  }

  function closeWrongBook() {
    $('wrongbook-modal').style.display = 'none';
  }

  // 错题再练：用错题本中的题开始一次练习
  function startWrongBookReview() {
    const keys = Object.keys(state.wrongBook);
    if (keys.length === 0) {
      showToast('错题本为空');
      return;
    }
    closeWrongBook();
    // 构造临时题库
    const questions = keys.map(k => state.wrongBook[k]).map((item, i) => ({
      id: item.id,
      subjectKey: item.subjectKey,
      question: item.question,
      options: item.options,
      answer: item.answer,
      explanation: item.explanation,
      category: item.category,
      ...pickExtFields(item)
    }));
    state.selectedSubject = '__wrongbook_review__';
    window.QUIZ_DATA = window.QUIZ_DATA || {};
    window.QUIZ_DATA['__wrongbook_review__'] = {
      name: '错题再练',
      icon: '❌',
      description: '来自错题本的题目',
      questions: questions
    };
    state.reviewMode = true;
    startQuiz();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ===== 弹窗控制 =====
  function showConflictModal(existing, incoming) {
    $('conflict-desc').textContent = `题库"${incoming.name}"已存在，请选择处理方式：`;
    $('conflict-info').innerHTML = `
      <div class="info-row"><span class="info-label">现有题量</span><span class="info-value">${existing.questions.length} 题</span></div>
      <div class="info-row"><span class="info-label">新文件题量</span><span class="info-value">${incoming.questions.length} 题</span></div>
    `;
    $('conflict-modal').style.display = 'flex';
  }

  function closeConflictModal() {
    $('conflict-modal').style.display = 'none';
    state.pendingImport = null;
  }

  function showResultModal(success, message) {
    $('result-modal-icon').textContent = success ? '✅' : '❌';
    $('result-modal-title').textContent = success ? '导入成功' : '导入失败';
    $('result-modal-desc').textContent = message;
    $('result-modal').style.display = 'flex';
  }

  function closeResultModal() {
    $('result-modal').style.display = 'none';
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ===== 主题切换 =====
  const THEMES = ['light', 'dark', 'aurora', 'sunset'];
  const THEME_ICONS = { light: '🌙', dark: '☀️', aurora: '🌙', sunset: '🌙' };

  function loadTheme() {
    const saved = localStorage.getItem('quiz-theme') || 'light';
    applyTheme(saved);
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    const btn = $('theme-toggle');
    if (btn) btn.textContent = THEME_ICONS[theme] || '🎨';
    localStorage.setItem('quiz-theme', theme);
  }

  function toggleThemePanel() {
    // 🌙 专职主题面板；打开主题时收起背景面板，两个面板互斥
    const bgPanel = $('bg-panel');
    if (bgPanel) bgPanel.classList.remove('show');
    $('theme-panel').classList.toggle('show');
  }

  function toggleBgPanel() {
    // 🖼️ 专职背景面板；打开背景时收起主题面板
    $('theme-panel').classList.remove('show');
    const bgPanel = $('bg-panel');
    if (bgPanel) bgPanel.classList.toggle('show');
  }

  // ===== 自定义背景 =====
  let particleAnim = null;

  function loadCustomBackground() {
    const saved = localStorage.getItem('quiz-bg');
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      if (data.type === 'particles') {
        applyParticlesBackground();
      } else {
        applyBackground(data.type, data.data);
      }
    } catch (e) {
      console.warn('加载背景失败', e);
    }
  }

  function clearAllBackgrounds() {
    const video = $('bg-video');
    const canvas = $('bg-particles');
    video.style.display = 'none';
    video.pause();
    video.removeAttribute('src');
    if (particleAnim) {
      cancelAnimationFrame(particleAnim);
      particleAnim = null;
    }
    canvas.style.display = 'none';
    document.body.style.backgroundImage = 'none';
    document.body.classList.remove('custom-bg');
  }

  function applyBackground(type, dataUrl) {
    clearAllBackgrounds();
    const video = $('bg-video');
    if (type === 'video') {
      video.src = dataUrl;
      video.style.display = 'block';
      video.play().catch(() => {});
      document.body.style.backgroundImage = 'none';
    } else {
      document.body.style.backgroundImage = `url(${dataUrl})`;
    }
    document.body.classList.add('custom-bg');
  }

  function applyParticlesBackground() {
    clearAllBackgrounds();
    document.body.classList.add('custom-bg');
    const canvas = $('bg-particles');
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    let particles = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const count = Math.min(80, Math.floor((canvas.width * canvas.height) / 15000));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2.5 + 0.5,
        dx: (Math.random() - 0.5) * 0.4,
        dy: (Math.random() - 0.5) * 0.4,
        opacity: Math.random() * 0.5 + 0.2
      });
    }

    function getThemeColor() {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme === 'dark') return 'rgba(129, 140, 248, ';
      if (theme === 'aurora') return 'rgba(16, 185, 129, ';
      if (theme === 'sunset') return 'rgba(249, 115, 22, ';
      return 'rgba(79, 70, 229, ';
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const color = getThemeColor();
      particles.forEach(p => {
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = color + p.opacity + ')';
        ctx.fill();
      });
      // 连线
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = color + (0.15 * (1 - dist / 120)) + ')';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      particleAnim = requestAnimationFrame(animate);
    }
    animate();
  }

  function handleBgFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const isVideo = file.type.startsWith('video/');
      const type = isVideo ? 'video' : 'image';
      try {
        localStorage.setItem('quiz-bg', JSON.stringify({ type, data: dataUrl }));
      } catch (err) {
        showToast('背景文件过大，无法保存（请选择较小的文件）');
        return;
      }
      applyBackground(type, dataUrl);
      showToast('背景已设置');
    };
    reader.readAsDataURL(file);
  }

  function setBackgroundType(type) {
    if (type === 'default') {
      resetBackground();
    } else if (type === 'particles') {
      localStorage.setItem('quiz-bg', JSON.stringify({ type: 'particles' }));
      applyParticlesBackground();
      showToast('粒子背景已启用');
    } else if (type === 'image') {
      $('bg-file-input').accept = 'image/*';
      $('bg-file-input').click();
    } else if (type === 'video') {
      $('bg-file-input').accept = 'video/*';
      $('bg-file-input').click();
    }
  }

  function resetBackground() {
    clearAllBackgrounds();
    localStorage.removeItem('quiz-bg');
    showToast('已恢复默认背景');
  }

  // ===== 点击波纹效果 =====
  const RIPPLE_SELECTOR = '.start-btn, .exam-start-btn, .import-btn, .option-item, .category-chip, .qty-option, .theme-option, .bg-upload-btn, .theme-toggle, .subject-card';

  function bindRippleEffects() {
    // 使用事件委托，支持动态创建的元素
    document.addEventListener('click', (e) => {
      const target = e.target.closest(RIPPLE_SELECTOR);
      if (target) {
        const rect = target.getBoundingClientRect();
        const ripple = document.createElement('span');
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;
        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        const bg = getComputedStyle(target).backgroundColor;
        const isLight = bg && (parseInt(bg.match(/\d+/)[0]) > 128);
        ripple.style.background = isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.5)';
        target.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      }
    });
  }

  // ===== 题库搜索 =====
  function filterSubjects(keyword) {
    const kw = keyword.trim().toLowerCase();
    document.querySelectorAll('.subject-card').forEach(card => {
      const name = card.querySelector('.subject-name').textContent.toLowerCase();
      const desc = (card.querySelector('.subject-desc')?.textContent || '').toLowerCase();
      card.style.display = (!kw || name.includes(kw) || desc.includes(kw)) ? '' : 'none';
    });
  }

  // ===== 分类筛选 =====
  function renderCategoryChips() {
    if (!state.selectedSubject || state.selectedSubject === '__wrongbook_review__') {
      $('category-section').style.display = 'none';
      state.activeCategory = null;
      return;
    }
    const subject = window.QUIZ_DATA[state.selectedSubject];
    // 套卷必须整卷按序作答，不提供分类筛选
    if (isPaperBank(subject)) {
      $('category-section').style.display = 'none';
      state.activeCategory = null;
      return;
    }
    const categories = [...new Set(subject.questions.map(q => q.category).filter(Boolean))];
    const container = $('category-chips');
    container.innerHTML = '';
    if (categories.length === 0) {
      $('category-section').style.display = 'none';
      return;
    }
    $('category-section').style.display = '';
    // 全部
    const all = document.createElement('div');
    all.className = 'category-chip active';
    all.textContent = '全部';
    all.addEventListener('click', () => selectCategory(null));
    container.appendChild(all);
    categories.forEach(cat => {
      const chip = document.createElement('div');
      chip.className = 'category-chip';
      chip.textContent = cat;
      chip.addEventListener('click', () => selectCategory(cat));
      container.appendChild(chip);
    });
  }

  function selectCategory(cat) {
    state.activeCategory = cat;
    document.querySelectorAll('.category-chip').forEach((chip, i) => {
      chip.classList.toggle('active', cat === null ? i === 0 : chip.textContent === cat);
    });
  }

  // 事件绑定入口
  function bindUxEvents() {
    // 主题（🌙）与背景（🖼️）各司其职，分别打开自己的面板
    $('theme-toggle').addEventListener('click', toggleThemePanel);
    $('bg-upload-btn').addEventListener('click', toggleBgPanel);
    document.querySelectorAll('.theme-option[data-theme]').forEach(opt => {
      opt.addEventListener('click', () => {
        applyTheme(opt.dataset.theme);
        $('theme-panel').classList.remove('show');
      });
    });
    // 背景类型选择
    document.querySelectorAll('.theme-option[data-bg]').forEach(opt => {
      opt.addEventListener('click', () => {
        setBackgroundType(opt.dataset.bg);
        $('bg-panel').classList.remove('show');
      });
    });
    document.addEventListener('click', (e) => {
      const tp = $('theme-panel');
      const bp = $('bg-panel');
      if (tp && !tp.contains(e.target) && e.target.id !== 'theme-toggle') {
        tp.classList.remove('show');
      }
      if (bp && !bp.contains(e.target) && e.target.id !== 'bg-upload-btn') {
        bp.classList.remove('show');
      }
    });

    // 自定义背景文件选择
    $('bg-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleBgFile(file);
      e.target.value = '';
    });
    $('bg-reset-btn').addEventListener('click', () => {
      resetBackground();
      $('bg-panel').classList.remove('show');
    });

    // 搜索
    $('subject-search').addEventListener('input', (e) => filterSubjects(e.target.value));

    // 点击波纹效果
    bindRippleEffects();
  }

  // ===== 事件绑定 =====
  function bindImportEvents() {
    $('import-btn').addEventListener('click', () => {
      $('file-input').click();
    });

    $('file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleImportFile(file);
      // 重置 input，允许重复选择同一文件
      e.target.value = '';
    });

    $('overwrite-btn').addEventListener('click', () => applyImport('overwrite'));
    $('append-btn').addEventListener('click', () => applyImport('append'));
    $('conflict-cancel-btn').addEventListener('click', closeConflictModal);
    $('result-modal-close-btn').addEventListener('click', closeResultModal);

    // 点击遮罩关闭弹窗
    $('conflict-modal').addEventListener('click', (e) => {
      if (e.target.id === 'conflict-modal') closeConflictModal();
    });
    $('result-modal').addEventListener('click', (e) => {
      if (e.target.id === 'result-modal') closeResultModal();
    });

    // 回收站相关
    $('recycle-btn').addEventListener('click', openRecycleBin);
    $('recycle-close-btn').addEventListener('click', closeRecycleBin);
    $('recycle-empty-btn').addEventListener('click', emptyRecycleBin);
    $('recycle-modal').addEventListener('click', (e) => {
      if (e.target.id === 'recycle-modal') closeRecycleBin();
    });

    // 错题本相关
    $('wrongbook-btn').addEventListener('click', openWrongBook);
    $('wrongbook-close-btn').addEventListener('click', closeWrongBook);
    $('wrongbook-clear-btn').addEventListener('click', clearWrongBook);
    $('wrongbook-review-btn').addEventListener('click', startWrongBookReview);
    $('wrongbook-modal').addEventListener('click', (e) => {
      if (e.target.id === 'wrongbook-modal') closeWrongBook();
    });

    // 模拟考试相关
    $('exam-start-btn').addEventListener('click', openExamConfig);
    $('exam-cancel-btn').addEventListener('click', closeExamConfig);
    $('exam-begin-btn').addEventListener('click', beginExam);
    $('exam-modal').addEventListener('click', (e) => {
      if (e.target.id === 'exam-modal') closeExamConfig();
    });
  }

  // ===== 成就弹窗 =====
  function openAchievementModal() {
    const unlocked = Object.keys(state.achievements).length;
    const pct = Math.round((unlocked / ACHIEVEMENTS.length) * 100);
    $('achievement-stats').innerHTML = `已解锁 <b>${unlocked}</b> / ${ACHIEVEMENTS.length} 个成就 · 完成度 <b>${pct}%</b>
      <div class="ach-total-bar"><div class="ach-total-fill" style="width:${pct}%"></div></div>`;

    // 按分类分组
    const cats = {};
    ACHIEVEMENTS.forEach(a => { (cats[a.cat] = cats[a.cat] || []).push(a); });

    const catIcons = { '答题': '📝', '连击': '⚡', '等级': '📈', '打卡': '📅', '综合': '🏆' };
    let html = '';
    for (const cat in cats) {
      const items = cats[cat];
      const catUnlocked = items.filter(a => state.achievements[a.id]).length;
      html += `<div class="ach-cat-header">${catIcons[cat] || ''} ${cat} <span class="ach-cat-count">${catUnlocked}/${items.length}</span></div>`;
      items.forEach(a => {
        const got = !!state.achievements[a.id];
        const progStr = a.progress ? a.progress() : '';
        const progParts = progStr ? progStr.split('/') : null;
        const progPct = progParts ? Math.min(100, Math.round((parseInt(progParts[0]) / parseInt(progParts[1])) * 100)) : 0;
        const unlockDate = got ? new Date(state.achievements[a.id]).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '';
        html += `<div class="ach-item ${got ? 'unlocked' : 'locked'}">
          <div class="ach-item-icon ${got ? '' : 'grayscale'}">${a.icon}</div>
          <div class="ach-item-text">
            <div class="ach-item-name">${a.name} ${got ? '✅' : '🔒'}</div>
            <div class="ach-item-desc">${a.desc}</div>
            ${progParts && !got ? `<div class="ach-progress-bar"><div class="ach-progress-fill" style="width:${progPct}%"></div></div><div class="ach-progress-label">${progParts[0]} / ${progParts[1]}</div>` : ''}
            ${got && unlockDate ? `<div class="ach-unlock-date">解锁于 ${unlockDate}</div>` : ''}
          </div>
        </div>`;
      });
    }
    $('achievement-list').innerHTML = html;
    $('achievement-modal').style.display = 'flex';
  }
  function updateAchievementBadge() {
    const count = Object.keys(state.achievements).length;
    const badge = $('achievement-badge');
    if (count > 0) { badge.textContent = count; badge.style.display = 'flex'; }
    else badge.style.display = 'none';
  }

  // ===== 学习日历热力图 =====
  function openHeatmapModal() {
    const container = $('heatmap-container');
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const days = 365;
    const start = new Date(today);
    start.setDate(start.getDate() - days);
    // 对齐到周日
    start.setDate(start.getDate() - start.getDay());

    const total = Object.values(state.studyLog).reduce((a, b) => a + b, 0);
    const activeDays = Object.keys(state.studyLog).length;
    const allCounts = Object.values(state.studyLog);
    const bestDay = allCounts.length > 0 ? Math.max(...allCounts) : 0;
    const avgPerDay = activeDays > 0 ? Math.round(total / activeDays) : 0;

    // 计算最长连续天数
    const sortedDates = Object.keys(state.studyLog).sort();
    let maxStreak = 0;
    let curStreak = 0;
    let prevDate = null;
    for (const ds of sortedDates) {
      const d = new Date(ds);
      if (prevDate) {
        const diff = Math.round((d - prevDate) / 86400000);
        if (diff === 1) curStreak++;
        else curStreak = 1;
      } else {
        curStreak = 1;
      }
      if (curStreak > maxStreak) maxStreak = curStreak;
      prevDate = d;
    }

    $('heatmap-summary').innerHTML = `
      <div class="hm-stat-row">
        <div class="hm-stat"><div class="hm-stat-val">${total}</div><div class="hm-stat-label">累计题数</div></div>
        <div class="hm-stat"><div class="hm-stat-val">${activeDays}</div><div class="hm-stat-label">活跃天数</div></div>
        <div class="hm-stat"><div class="hm-stat-val">${bestDay}</div><div class="hm-stat-label">最佳单日</div></div>
        <div class="hm-stat"><div class="hm-stat-val">${avgPerDay}</div><div class="hm-stat-label">日均</div></div>
        <div class="hm-stat"><div class="hm-stat-val">${maxStreak}</div><div class="hm-stat-label">最长连续</div></div>
      </div>`;

    const weeks = Math.ceil((days + (today.getDay() + 1)) / 7);
    const colors = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

    // 月份标签
    const todayStr = localDateStr(today);
    let monthLabels = '<div class="hm-month-row"><div class="hm-day-label-spacer"></div>';
    let lastMonth = -1;
    const d = new Date(start);
    for (let w = 0; w < weeks; w++) {
      const m = d.getMonth();
      if (m !== lastMonth) {
        monthLabels += `<div class="hm-month-label">${m + 1}月</div>`;
        lastMonth = m;
      } else {
        monthLabels += '<div class="hm-month-label"></div>';
      }
      d.setDate(d.getDate() + 7);
    }
    monthLabels += '</div>';

    // 主网格（带星期标签）
    let html = '<div class="hm-wrap">' + monthLabels;
    html += '<div class="hm-grid-row"><div class="hm-day-labels">';
    const dayLabels = ['日', '', '二', '', '四', '', '六'];
    for (const dl of dayLabels) html += `<div class="hm-day-label">${dl}</div>`;
    html += '</div><div class="heatmap-grid" style="grid-template-columns: repeat(' + weeks + ', 1fr);">';

    const d2 = new Date(start);
    for (let i = 0; i < weeks * 7; i++) {
      const dateStr = localDateStr(d2);
      const count = state.studyLog[dateStr] || 0;
      const isFuture = d2 > today;
      const isToday = dateStr === todayStr;
      let color = '#ebedf0';
      if (count > 0 && !isFuture) {
        const idx = Math.min(4, Math.ceil(count / 5));
        color = colors[idx];
      }
      const title = isFuture ? '' : `${dateStr}: ${count} 题`;
      const cls = 'heatmap-cell' + (isToday ? ' today' : '') + (isFuture ? ' future' : '');
      html += `<div class="${cls}" style="background:${color};" title="${title}"></div>`;
      d2.setDate(d2.getDate() + 1);
    }
    html += '</div></div></div>';
    container.innerHTML = html;
    $('heatmap-modal').style.display = 'flex';
  }

  // ===== 收藏夹弹窗 =====
  function openFavoritesModal() {
    const list = $('favorites-list');
    const favs = Object.values(state.favorites);
    if (favs.length === 0) {
      list.innerHTML = '<div class="empty-state">还没有收藏的题目</div>';
    } else {
      list.innerHTML = favs.map(f => `
        <div class="recycle-item">
          <div class="recycle-item-info">
            <div class="recycle-item-name">${escapeHtml(f.question)}</div>
            <div class="recycle-item-meta">${f.category || ''}</div>
          </div>
          <button class="recycle-remove" data-favkey="${f.subjectKey}__${f.id}">✕</button>
        </div>
      `).join('');
      list.querySelectorAll('.recycle-remove').forEach(btn => {
        btn.onclick = () => {
          const key = btn.dataset.favkey;
          delete state.favorites[key];
          saveFavorites();
          openFavoritesModal();
          updateFavoritesBadge();
        };
      });
    }
    $('favorites-modal').style.display = 'flex';
  }
  function updateFavoritesBadge() {
    const count = Object.keys(state.favorites).length;
    const badge = $('favorites-badge');
    if (count > 0) { badge.textContent = count; badge.style.display = 'flex'; }
    else badge.style.display = 'none';
  }
  function startFavoritesReview() {
    const favs = Object.values(state.favorites);
    if (favs.length === 0) { showToast('还没有收藏的题目'); return; }
    state.selectedSubject = '__favorites__';
    state.questions = favs.map(f => ({ ...f }));
    state.currentIndex = 0;
    state.answers = [];
    state.combo = 0;
    state.reviewMode = true;
    $('favorites-modal').style.display = 'none';
    showPage('quiz');
    renderQuestion();
  }

  // ===== 首页徽章（等级/XP/打卡）=====
  function renderHomeBadges() {
    const container = $('home-badges');
    if (!container) return;
    const xpNeeded = xpForLevel(state.level);
    const xpPct = Math.min(100, Math.round((state.xp / xpNeeded) * 100));
    container.innerHTML = `
      <div class="home-badge">
        <div class="badge-icon">🏆</div>
        <div class="badge-text">
          <div class="badge-title">Lv.${state.level}</div>
          <div class="xp-bar"><div class="xp-fill" style="width:${xpPct}%"></div></div>
          <div class="xp-label">${state.xp}/${xpNeeded} XP</div>
        </div>
      </div>
      <div class="home-badge">
        <div class="badge-icon">🔥</div>
        <div class="badge-text">
          <div class="badge-title">连续打卡</div>
          <div class="badge-value">${state.streakDays} 天</div>
        </div>
      </div>
    `;
  }

  // ===== 每日一言 =====
  function renderDailyQuote() {
    const el = $('daily-quote');
    if (el) el.textContent = getDailyQuote();
  }

  // ===== 标题打字机效果 =====
  function typewriterTitle() {
    const el = $('app-title');
    if (!el) return;
    const full = el.textContent;
    el.textContent = '';
    let i = 0;
    const interval = setInterval(() => {
      if (i < full.length) {
        el.textContent += full.charAt(i);
        i++;
      } else {
        clearInterval(interval);
      }
    }, 120);
  }

  // ===== 卡片错落入场动画 =====
  function staggerCards() {
    const cards = document.querySelectorAll('.subject-card');
    cards.forEach((card, i) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(30px)';
      setTimeout(() => {
        card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, i * 80);
    });
  }

  // ===== 游戏化功能事件绑定 =====
  function bindGamificationEvents() {
    $('achievement-btn').addEventListener('click', openAchievementModal);
    $('heatmap-btn').addEventListener('click', openHeatmapModal);
    $('favorites-btn').addEventListener('click', openFavoritesModal);
    $('favorites-review-btn').addEventListener('click', startFavoritesReview);
    $('favorites-clear-btn').addEventListener('click', () => {
      if (Object.keys(state.favorites).length === 0) return;
      if (confirm('确定要清空所有收藏吗？')) {
        state.favorites = {};
        saveFavorites();
        openFavoritesModal();
        updateFavoritesBadge();
      }
    });
    // 点击遮罩关闭弹窗
    ['achievement-modal', 'heatmap-modal', 'favorites-modal'].forEach(id => {
      $(id).addEventListener('click', (e) => {
        if (e.target.id === id) $(id).style.display = 'none';
      });
    });
  }

  // ===== 检查更新 =====
  // 与泡泡课表同一套方案：查 GitHub Release -> 比版本 -> 下载 -> 拉起安装。
  // App 内（Capacitor WebView）走原生插件（DownloadManager 下载 + 自动拉起安装器）；
  // 浏览器里打开时退化为「跳转浏览器下载 APK」。
  // 版本号三处必须一起改：这里、android/app/build.gradle 的 versionName、package.json。
  // 落后于 Release tag 会让「发现新版本」弹窗永远消不掉；tools/build-www.js 每次构建都会核对。
  const APP_VERSION = '1.8.0';
  const GITHUB_OWNER = 'cedarln';
  const GITHUB_REPO = 'paopao-quiz';
  const API_LATEST = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest';

  // 传送门：在线题库广场，题库 JSON 存放在仓库的 quizzes/ 目录
  const PORTAL_API = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/quizzes';
  const PORTAL_LOADED_STORAGE = 'quiz-portal-loaded';

  const isNativeApp = () => {
    try {
      return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  };

  // 直接走 Capacitor 注入运行时的底层桥（nativePromise）调用原生更新插件。
  // 关键：window.Capacitor.Plugins 只有在应用 JS 里打包了 @capacitor/core 并
  // 调用 registerPlugin() 后才会填充；纯 HTML 应用（无打包器）里它永远是空的，
  // 所以不能用 window.Capacitor.Plugins.UpdateChecker（v1.3.6 之前的问题根源）。
  function nativeUpdateCall(method, args) {
    const cap = window.Capacitor;
    if (cap && typeof cap.nativePromise === 'function') {
      return cap.nativePromise('UpdateChecker', method, args || {});
    }
    return Promise.reject(new Error('应用内更新组件不可用'));
  }

  // 用系统浏览器下载 APK：绝不在应用内 WebView 里打开 GitHub 页面
  // （Capacitor 会把外部 URL 转交给系统浏览器；纯浏览器环境用新标签页）
  function browserDownloadUpdate(url) {
    if (isNativeApp()) {
      showToast('正在打开系统浏览器下载…');
      window.location.href = url;
    } else {
      window.open(url, '_blank');
    }
  }

  // "v1.2.3" -> "1.2.3"
  function normalizeVersion(tag) {
    const m = String(tag || '').match(/(\d+(\.\d+)*)/);
    return m ? m[1] : '';
  }

  // 按数字段比较版本：>0 表示 a 更新
  function compareVersions(a, b) {
    const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function setUpdateModalBusy(busy) {
    $('update-now-btn').disabled = busy;
    $('update-later-btn').disabled = busy;
    $('update-now-btn').textContent = busy ? '下载中…' : '立即更新';
  }

  let lastApkUrl = '';

  function openUpdateModal(latest, current, apkUrl) {
    lastApkUrl = apkUrl;
    $('update-modal-icon').textContent = '🎉';
    $('update-modal-title').textContent = '发现新版本 v' + normalizeVersion(latest.tag);
    $('update-modal-desc').textContent =
      `当前版本 v${current}，最新版本 v${normalizeVersion(latest.tag)}（${formatSize(latest.size)}）`;
    const notes = $('update-notes');
    if (latest.notes) {
      // Release 说明按 markdown 写的，这里做个最朴素的渲染：去掉 # 标记，保留换行
      notes.textContent = latest.notes.replace(/^#{1,6}\s*/gm, '').trim();
      notes.style.display = 'block';
    } else {
      notes.textContent = '';
      notes.style.display = 'none';
    }
    $('update-progress').style.display = 'none';
    $('update-progress-fill').style.width = '0%';
    $('update-progress-text').textContent = '0%';
    const fb = $('update-browser-btn');
    if (fb) { fb.style.display = 'block'; fb.textContent = '⬇️ 应用内下载有问题？用系统浏览器下载'; }
    setUpdateModalBusy(false);
    $('update-now-btn').onclick = () => startNativeDownload(latest, apkUrl);
    $('update-modal').style.display = 'flex';
  }

  // 下载失败 / 应用内更新组件不可用时的后路：改用系统浏览器下载
  function showBrowserFallback() {
    const btn = $('update-browser-btn');
    if (btn && lastApkUrl) {
      btn.style.display = 'block';
      btn.textContent = '⚠️ 应用内下载失败？点此用系统浏览器下载';
    }
  }

  // App 内下载 + 自动拉起安装；进度不靠插件事件（纯 HTML 应用监听不到），
  // 而是 JS 每 700ms 轮询一次原生 downloadProgress
  function startNativeDownload(latest, apkUrl) {
    setUpdateModalBusy(true);
    $('update-progress').style.display = 'block';
    nativeUpdateCall('startDownload', { url: apkUrl }).then(res => {
      if (!res || !res.fileName) throw new Error('下载任务创建失败');
      pollDownload(res.fileName, res.downloadId);
    }).catch(err => {
      setUpdateModalBusy(false);
      $('update-progress').style.display = 'none';
      if (err && err.message === '应用内更新组件不可用') {
        // 原生环境但拿不到更新桥：直接交给系统浏览器，不在应用内打开 GitHub
        browserDownloadUpdate(apkUrl);
        return;
      }
      showToast('下载失败：' + (err && err.message ? err.message : '未知错误'));
      showBrowserFallback();
    });
  }

  // 轮询下载进度：status 8 = DownloadManager.STATUS_SUCCESSFUL，16 = STATUS_FAILED
  function pollDownload(fileName, downloadId) {
    const startedAt = Date.now();
    const TIMEOUT_MS = 20 * 60 * 1000; // 20 分钟没下完就建议换浏览器
    const timer = setInterval(() => {
      nativeUpdateCall('downloadProgress', { downloadId: downloadId }).then(p => {
        const fill = $('update-progress-fill');
        if (fill && p.total > 0) {
          fill.style.width = p.percent + '%';
          $('update-progress-text').textContent =
            p.percent + '% · ' + formatSize(p.downloaded) + '/' + formatSize(p.total);
        }
        if (p.status === 8) {
          clearInterval(timer);
          setUpdateModalBusy(false);
          $('update-progress').style.display = 'none';
          showToast('下载完成，正在拉起安装…');
          tryInstall(fileName);
        } else if (p.status === 16) {
          clearInterval(timer);
          setUpdateModalBusy(false);
          $('update-progress').style.display = 'none';
          showToast('下载失败，请检查网络后重试');
          showBrowserFallback();
        } else if (Date.now() - startedAt > TIMEOUT_MS) {
          clearInterval(timer);
          setUpdateModalBusy(false);
          $('update-progress').style.display = 'none';
          showToast('下载超时，建议改用系统浏览器下载');
          showBrowserFallback();
        }
      }).catch(() => {
        clearInterval(timer);
        setUpdateModalBusy(false);
        $('update-progress').style.display = 'none';
        showToast('无法获取下载进度，请改用系统浏览器');
        showBrowserFallback();
      });
    }, 700);
  }

  // 等待安装的更新包文件名（权限授权后回到 App 自动继续安装）
  const PENDING_INSTALL_STORAGE = 'quiz-pending-install';

  // 主动拉起安装器；需要「安装未知应用」权限时记录待安装文件，授权回来后自动继续
  function tryInstall(fileName) {
    if (!fileName) return;
    nativeUpdateCall('installApk', { fileName: fileName }).then(res => {
      if (res.started) {
        localStorage.removeItem(PENDING_INSTALL_STORAGE);
        $('update-modal').style.display = 'none';
        showToast('已打开安装器，安装完成后应用会自动重启');
      } else {
        // 跳去了「安装未知应用」授权页：记住待安装包，回到 App 自动续装
        localStorage.setItem(PENDING_INSTALL_STORAGE, fileName);
        $('update-modal-desc').textContent =
          '需要「安装未知应用」权限：请在打开的设置页中允许，返回后将继续自动安装';
        setUpdateModalBusy(false);
        $('update-now-btn').disabled = true;
        $('update-now-btn').textContent = '等待授权…';
        showToast('请在设置中允许「安装未知应用」，返回后自动继续');
      }
    }).catch(err => {
      setUpdateModalBusy(false);
      showToast('安装失败：' + (err && err.message ? err.message : '未知错误'));
    });
  }

  // 从授权页回到 App：自动继续安装待安装的更新包
  function bindInstallResume() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const pending = localStorage.getItem(PENDING_INSTALL_STORAGE);
      if (!pending) return;
      nativeUpdateCall('installApk', { fileName: pending }).then(res => {
        if (res.started) {
          localStorage.removeItem(PENDING_INSTALL_STORAGE);
          $('update-modal').style.display = 'none';
          showToast('已打开安装器，安装完成后应用会自动重启');
        }
        // 仍未授权则什么都不做，下次回到 App 再试
      }).catch(() => {
        localStorage.removeItem(PENDING_INSTALL_STORAGE); // 文件没了，清掉记录
      });
    });
  }

  // 启动时检查遗留更新包：已装完的提示删除释放空间；没装完的提示继续安装
  let cleanupModalHandler = null;
  function showCleanupModal(icon, title, desc, okLabel, onOk) {
    $('cleanup-icon').textContent = icon;
    $('cleanup-title').textContent = title;
    $('cleanup-desc').textContent = desc;
    $('cleanup-ok-btn').textContent = okLabel;
    cleanupModalHandler = onOk;
    $('cleanup-modal').style.display = 'flex';
  }

  function bindCleanupModal() {
    $('cleanup-ok-btn').addEventListener('click', () => {
      $('cleanup-modal').style.display = 'none';
      if (cleanupModalHandler) cleanupModalHandler();
      cleanupModalHandler = null;
    });
    $('cleanup-cancel-btn').addEventListener('click', () => {
      $('cleanup-modal').style.display = 'none';
      cleanupModalHandler = null;
    });
  }

  function checkLeftoverUpdates() {
    if (!isNativeApp()) return;
    nativeUpdateCall('listDownloadedUpdates').then(res => {
      const files = res.files || [];
      if (!files.length) return;
      const installed = files.find(f => f.installedOrOlder);
      if (installed) {
        showCleanupModal('🧹', '清理更新包',
          `上次下载的更新包（v${installed.version || '?'}，${formatSize(installed.size)}）看起来已经安装完成，要删除它以释放空间吗？`,
          '删除', () => {
            nativeUpdateCall('deleteUpdateFile', { fileName: installed.fileName }).catch(() => {});
          });
      } else {
        const pending = files[0];
        showCleanupModal('📦', '发现未安装的更新',
          `存在一个尚未安装的更新包（v${pending.version || '?'}，${formatSize(pending.size)}），要现在安装吗？`,
          '立即安装', () => {
            tryInstall(pending.fileName);
          });
      }
    }).catch(() => {});
  }

  // ===== Android 系统返回键 =====
  // 界面切换是 class 切换（浏览器 history 无记录），默认按返回键会直接退出应用。
  // 接管返回键：优先关闭最上层弹窗/面板 → 子页面回首页 → 首页才退出应用。
  function closeTopOverlay() {
    const modals = Array.from(document.querySelectorAll('.modal-overlay'))
      .filter(m => m.style.display === 'flex');
    if (modals.length) {
      const top = modals[modals.length - 1];
      // 套卷分节提示不允许直接关闭：返回键等同于进入下一节
      if (top.id === 'paper-section-modal') {
        const next = state.paperPendingSection;
        if (next !== null && next !== undefined) startPaperSection(next);
        return true;
      }
      top.style.display = 'none';
      if (top.id === 'update-modal') setUpdateModalBusy(false);
      return true;
    }
    const panels = Array.from(document.querySelectorAll('.theme-panel.show'));
    if (panels.length) {
      panels.forEach(p => p.classList.remove('show'));
      return true;
    }
    return false;
  }

  function bindAndroidBackButton() {
    const cap = window.Capacitor;
    if (!isNativeApp() || !cap || typeof cap.addListener !== 'function') return;
    // 关键：事件必须用 addListener 注册（走插件的 addListener 方法，原生端
    // AppPlugin.hasListeners 才会返回 true）。直接 nativeCallback('App',
    // 'backButton', ...) 调的是不存在的方法，会静默失败，返回键被原生层吞掉。
    cap.addListener('App', 'backButton', (data) => {
      // 1. 有弹窗（含更新/清理/成就等）或主题背景面板打开 → 先关掉
      if (closeTopOverlay()) return;
      // 2. 答题页
      if (currentPage === 'quiz') {
        // 测评：自动缓存进度回首页（可「继续测试」恢复），无需确认
        if (state.isAssessment) {
          saveAssessmentDraft(state.selectedSubject, {
            answers: state.answers, currentIndex: state.currentIndex, questions: state.questions
          });
          cleanupQuizSession();
          showPage('home');
          checkStartButton();
          showToast('已保存测试进度，可随时继续');
          return;
        }
        // 考试（含套卷）：返回键等同于交卷并查看结果
        if (state.isExam) {
          if (!window.confirm('确定要交卷并退出考试吗？')) return;
          submitExam();
          return;
        }
        if (window.confirm('确定要退出本次刷题吗？进度将不会保存。')) {
          cleanupQuizSession();
          showPage('home');
          checkStartButton();
        }
        return;
      }
      // 3. 结果页 → 回首页
      if (currentPage === 'result') {
        cleanupQuizSession();
        showPage('home');
        updateStatsUI();
        checkStartButton();
        return;
      }
      // 4. 首页：history 有记录就后退，否则退出应用
      if (data && data.canGoBack) { window.history.back(); return; }
      cap.nativePromise('App', 'exitApp').catch(() => {});
    });
  }

  function checkForUpdate() {
    if (isNativeApp()) {
      showToast('正在检查更新…');
      nativeUpdateCall('checkUpdate').then(res => {
        if (res.hasUpdate) {
          openUpdateModal(res, res.current, res.url);
        } else {
          showToast(`已是最新版本（v${res.current}）`);
        }
      }).catch(err => {
        // 原生检查失败（网络受限或组件缺失）→ 退回网页兜底（只走系统浏览器）
        checkForUpdateViaWeb(err && err.message ? err.message : '未知错误');
      });
    } else {
      checkForUpdateViaWeb('');
    }
  }

  function checkForUpdateViaWeb(reason) {
    showToast('正在检查更新…');
    if (reason && window.Capacitor) {
      showToast('应用内更新不可用（' + reason + '），将改用系统浏览器下载');
    }
    fetch(API_LATEST).then(r => {
      if (!r.ok) throw new Error('GitHub API 返回 ' + r.status);
      return r.json();
    }).then(rel => {
      if (compareVersions(normalizeVersion(rel.tag_name), APP_VERSION) > 0) {
        const asset = (rel.assets || []).find(a => a.name.toLowerCase().endsWith('.apk'));
        if (!asset) throw new Error('最新 Release 里没有 APK 文件');
        if (confirm(`发现新版本 v${normalizeVersion(rel.tag_name)}（当前 v${APP_VERSION}），是否前往下载？`)) {
          browserDownloadUpdate(asset.browser_download_url);
        }
      } else {
        showToast(`已是最新版本（v${APP_VERSION}）`);
      }
    }).catch(err => {
      showToast('检查更新失败：' + err.message);
    });
  }

  // ===== 传送门：在线题库广场 =====
  // 题库 JSON 存放在 GitHub 仓库的 quizzes/ 目录；发布新题库 = 往该目录上传 JSON 文件。
  // 这里通过 GitHub Contents API 匿名列出目录，点击即抓取 raw 内容走现有导入流程。

  function getPortalMarkers() {
    try { return JSON.parse(localStorage.getItem(PORTAL_LOADED_STORAGE)) || {}; } catch (e) { return {}; }
  }

  function setPortalMarker(fileName, sha) {
    const markers = getPortalMarkers();
    markers[fileName] = { sha: sha, loadedAt: Date.now() };
    try { localStorage.setItem(PORTAL_LOADED_STORAGE, JSON.stringify(markers)); } catch (e) {}
  }

  function updatePortalBadge(count) {
    const badge = $('portal-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  function portalItemStatus(item, markers) {
    const marker = markers[item.name];
    if (marker && marker.sha === item.sha) return { cls: 'loaded', label: '已加载' };
    if (marker) return { cls: 'update', label: '有更新' };
    return { cls: 'new', label: '未加载' };
  }

  // 列表状态：题库名普遍很长（「思想政治学科知识与教学能力 模拟卷 第1回」这种），
  // 单行 + 跑马灯在手机上只能看到个头，所以改成折行两行后省略 + 搜索 + 状态筛选。
  let portalAllItems = [];
  let portalFilter = 'all';
  const PORTAL_STATUS_ORDER = { new: 0, update: 1, loaded: 2 };

  function portalItemVisible(item, st, query, ignoreFilter) {
    if (!ignoreFilter) {
      if (portalFilter === 'todo' && st.cls === 'loaded') return false;
      if (portalFilter === 'loaded' && st.cls !== 'loaded') return false;
    }
    if (!query) return true;
    return (item.displayName + ' ' + item.name + ' ' + (item.bankKey || '')).toLowerCase().includes(query);
  }

  // chip 上的计数即筛选结果，省掉单独一行「共 N 个」的说明文字
  function setPortalChipCounts(todo, loaded) {
    const t = $('portal-n-todo');
    const l = $('portal-n-loaded');
    if (t) t.textContent = todo;
    if (l) l.textContent = loaded;
  }

  function renderPortalList(items) {
    const list = $('portal-list');
    const markers = getPortalMarkers();
    portalAllItems = items;
    if (!items.length) {
      list.innerHTML = '<div class="portal-empty">仓库的 quizzes/ 目录还没有题库文件，快去发布第一个吧。</div>';
      setPortalChipCounts(0, 0);
      updatePortalBadge(0);
      return;
    }
    const searchEl = $('portal-search');
    const query = ((searchEl && searchEl.value) || '').trim().toLowerCase();
    // 先按搜索词收窄，再按状态筛选；chip 上的数字跟着搜索词变，方便判断「搜到了但都装过了」
    const matched = items.map(item => ({ item, st: portalItemStatus(item, markers) }))
      .filter(d => portalItemVisible(d.item, d.st, query, true));
    const todo = matched.filter(d => d.st.cls !== 'loaded').length;
    const shown = matched.filter(d => portalItemVisible(d.item, d.st, query, false));
    shown.sort((a, b) => {
      const byStatus = PORTAL_STATUS_ORDER[a.st.cls] - PORTAL_STATUS_ORDER[b.st.cls];
      if (byStatus) return byStatus;
      return String(a.item.displayName).localeCompare(String(b.item.displayName), 'zh-Hans-CN', { numeric: true });
    });
    setPortalChipCounts(todo, matched.length - todo);
    updatePortalBadge(todo);

    list.innerHTML = shown.length ? shown.map(({ item, st }) => `
        <div class="portal-item ${st.cls}" data-file="${escapeHtml(item.name)}">
          <div class="portal-item-name">${escapeHtml(item.displayName)}</div>
          <div class="portal-item-foot">
            <div class="portal-item-meta">${item.size ? formatSize(item.size) : ''}${item.bankKey && item.bankKey !== item.displayName ? `<span class="portal-item-key">${escapeHtml(item.bankKey)}</span>` : ''}</div>
            <span class="portal-status ${st.cls}">${st.label}</span>
          </div>
        </div>`).join('')
      : '<div class="portal-empty">没有匹配的题库。换个关键词（如 vocab / paper / 词汇 / 综合素质），或点上面「全部」。</div>';
    list.querySelectorAll('.portal-item').forEach(el => {
      el.addEventListener('click', () => {
        const item = portalAllItems.find(it => it.name === el.dataset.file);
        if (item) loadPortalBank(item);
      });
    });
  }

  function loadPortalList(silent) {
    const list = $('portal-list');
    if (!silent) list.innerHTML = '<div class="portal-empty">🌀 正在从 GitHub 加载题库列表…</div>';
    fetch(PORTAL_API + '?t=' + Date.now())
      .then(r => {
        if (!r.ok) {
          if (r.status === 404) throw new Error('仓库里还没有 quizzes/ 目录');
          if (r.status === 403) throw new Error('GitHub 请求太频繁，请稍后再试');
          throw new Error('GitHub API 返回 ' + r.status);
        }
        return r.json();
      })
      .then(files => {
        const items = (Array.isArray(files) ? files : [])
          .filter(f => f.type === 'file' && f.name.toLowerCase().endsWith('.json'))
          .map(f => {
            const base = f.name.replace(/\.json$/i, '');
            // 允许用「展示名~原文件名.json」的方式给题库起好看的展示名
            const hasKey = base.includes('~');
            const displayName = hasKey ? base.split('~')[0] : base;
            const bankKey = hasKey ? base.split('~').slice(1).join('~') : base;
            return { name: f.name, displayName, bankKey, size: f.size, sha: f.sha, downloadUrl: f.download_url };
          });
        renderPortalList(items);
      })
      .catch(err => {
        list.innerHTML = '<div class="portal-empty">加载失败：' + escapeHtml(err.message) + '<br>请检查网络后点右上角「刷新」重试</div>';
      });
  }

  function loadPortalBank(item) {
    showToast('正在加载「' + item.displayName + '」…');
    fetch(item.downloadUrl + (item.downloadUrl.includes('?') ? '&' : '?') + 't=' + Date.now())
      .then(r => {
        if (!r.ok) throw new Error('下载失败（HTTP ' + r.status + '）');
        return r.text();
      })
      .then(text => {
        const data = JSON.parse(text);
        const validation = validateBankConfig(data);
        if (!validation.valid) {
          showResultModal(false, '配置文件校验失败：' + validation.error);
          return;
        }
        // 记录已加载的文件版本（sha），用于显示「有更新」标记
        setPortalMarker(item.name, item.sha);
        processImport(data);
        // 导入成功：自动关闭在线题库弹窗（导入结果由独立的提示弹窗展示）
        closePortalModal();
      })
      .catch(err => {
        showResultModal(false, '在线加载失败：' + (err instanceof SyntaxError ? '文件不是合法的 JSON' : err.message));
      });
  }

  function openPortalModal() {
    $('portal-modal').style.display = 'flex';
    // 每次打开回到「全部 + 空搜索」：留着上次的关键词会让人以为仓库题库变少了
    const searchEl = $('portal-search');
    if (searchEl) searchEl.value = '';
    portalFilter = 'all';
    document.querySelectorAll('#portal-filters .portal-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === 'all');
    });
    refreshAudioCacheBar();
    loadPortalList(false);
  }

  function closePortalModal() {
    $('portal-modal').style.display = 'none';
  }

  function bindPortalAndUpdateEvents() {
    $('portal-btn').addEventListener('click', openPortalModal);
    $('portal-close-btn').addEventListener('click', closePortalModal);
    $('portal-refresh-btn').addEventListener('click', () => loadPortalList(false));
    const searchEl = $('portal-search');
    if (searchEl) searchEl.addEventListener('input', () => renderPortalList(portalAllItems));
    document.querySelectorAll('#portal-filters .portal-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        portalFilter = chip.dataset.filter || 'all';
        document.querySelectorAll('#portal-filters .portal-chip').forEach(c => c.classList.toggle('active', c === chip));
        renderPortalList(portalAllItems);
      });
    });
    $('portal-modal').addEventListener('click', (e) => {
      if (e.target.id === 'portal-modal') closePortalModal();
    });
    $('update-btn').addEventListener('click', checkForUpdate);
    $('update-browser-btn').addEventListener('click', () => {
      if (lastApkUrl) browserDownloadUpdate(lastApkUrl);
    });
    $('update-later-btn').addEventListener('click', () => {
      $('update-modal').style.display = 'none';
    });
    $('update-modal').addEventListener('click', (e) => {
      if (e.target.id === 'update-modal' && !$('update-now-btn').disabled) {
        $('update-modal').style.display = 'none';
      }
    });
  }

  // ===== 初始化 =====
  async function init() {
    loadTheme();
    loadCustomBackground();
    loadStats();
    loadXp();
    loadAchievements();
    loadFavorites();
    loadStudyLog();
    await loadImportedBanks(); // 需在渲染题库列表前完成（含旧数据迁移）
    loadRecycleBin();
    loadWrongBook();
    updateStreak();
    hideDeletedBanks(); // 隐藏已放入回收站的题库
    renderSubjectList();
    renderHomeBadges();
    renderDailyQuote();
    renderExamCountdown();
    typewriterTitle();
    initSettings();
    bindQuizEvents();
    bindQuestionNav();
    bindResultEvents();
    bindImportEvents();
    bindUxEvents();
    bindGamificationEvents();
    bindPortalAndUpdateEvents();
    bindInstallResume();
    bindCleanupModal();
    bindAndroidBackButton();
    checkLeftoverUpdates(); // 检查遗留更新包：已装完提示删除，没装完提示继续装
    updateStatsUI();
    updateRecycleBinBadge();
    updateWrongBookBadge();
    updateAchievementBadge();
    updateFavoritesBadge();
    staggerCards();
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

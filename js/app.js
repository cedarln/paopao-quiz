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
  function loadStudyLog() {
    const saved = localStorage.getItem(STUDY_LOG_STORAGE);
    if (saved) { try { state.studyLog = JSON.parse(saved); } catch (e) {} }
  }
  function saveStudyLog() {
    localStorage.setItem(STUDY_LOG_STORAGE, JSON.stringify(state.studyLog));
  }
  function logStudy() {
    const today = new Date().toISOString().slice(0, 10);
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
      state.favorites[key] = { subjectKey: state.selectedSubject, id: q.id, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation, category: q.category };
    }
    saveFavorites();
    return !state.favorites[key] ? false : true;
  }
  function isFavorite(q) {
    return !!state.favorites[`${state.selectedSubject}__${q.id}`];
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

  function checkStartButton() {
    const has = !!state.selectedSubject;
    $('start-btn').disabled = !has;
    $('exam-start-btn').disabled = !has;
  }

  // ===== 题量和模式选择 =====
  function initSettings() {
    $('qty-options').addEventListener('click', (e) => {
      const btn = e.target.closest('.qty-btn');
      if (!btn) return;
      document.querySelectorAll('.qty-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.qty = parseInt(btn.dataset.qty, 10);
    });

    $('mode-options').addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
    });

    $('start-btn').addEventListener('click', startQuiz);
  }

  // ===== 开始刷题 =====
  function startQuiz() {
    if (!state.selectedSubject) return;

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

    // 根据模式选择题目
    if (state.mode === 'random' || state.isExam) {
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
    }
  }

  // ===== 模拟考试 =====
  function openExamConfig() {
    if (!state.selectedSubject) {
      showToast('请先选择一个科目');
      return;
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
    updateExamTimerDisplay();
    state.examTimer = setInterval(() => {
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
    const m = Math.floor(state.examTimeLeft / 60);
    const s = state.examTimeLeft % 60;
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    // 剩余不足1分钟变红
    el.classList.toggle('timer-warning', state.examTimeLeft <= 60);
  }

  function submitExam() {
    stopExamTimer();
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
    $('result-title').textContent = '考试结束';
    $('result-message').textContent = message;

    reviewFilter = 'all';
    renderReview();
    showPage('result');
  }

  // ===== 渲染题目 =====
  function renderQuestion() {
    const q = state.questions[state.currentIndex];
    const total = state.questions.length;
    const idx = state.currentIndex + 1;

    // 更新进度
    $('progress-text').textContent = `${idx} / ${total}`;
    $('progress-fill').style.width = `${(idx / total) * 100}%`;

    // 考试模式：显示倒计时，隐藏跳过按钮
    $('exam-timer-bar').style.display = state.isExam ? 'flex' : 'none';
    $('skip-btn').style.display = state.isExam ? 'none' : '';

    // 题目内容
    $('question-category').textContent = q.category || '选择题';
    $('question-index').textContent = `第 ${idx} 题`;
    $('question-text').textContent = q.question;

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

    // 选项
    const optionsContainer = $('options-list');
    optionsContainer.innerHTML = '';
    const currentAnswer = state.answers[state.currentIndex];
    q.options.forEach((option, i) => {
      const item = document.createElement('div');
      item.className = 'option-item';
      item.dataset.index = i;
      // 考试模式：高亮已选选项（不显示对错）
      if (state.isExam && currentAnswer && currentAnswer.selected === i) {
        item.classList.add('selected');
      }
      item.innerHTML = `
        <div class="option-label">${OPTION_LABELS[i]}</div>
        <div class="option-text">${option}</div>
      `;
      item.addEventListener('click', () => selectOption(i));
      optionsContainer.appendChild(item);
    });

    // 隐藏答案解析（考试模式始终隐藏）
    if (state.isExam) {
      $('answer-result').style.display = 'none';
    } else {
      $('answer-result').style.display = 'none';
    }

    // 更新按钮状态
    $('prev-btn').disabled = state.currentIndex === 0;
    const nextBtn = $('next-btn');

    if (state.isExam) {
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
    const total = state.questions.length;
    const correctCount = state.answers.filter(a => a && a.isRight).length;
    const wrongCount = total - correctCount;
    const rate = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const score = rate;

    $('score-number').textContent = score;
    $('detail-correct').textContent = correctCount;
    $('detail-wrong').textContent = wrongCount;
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
    $('result-title').textContent = rate >= 60 ? '刷题完成！' : '继续努力！';
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
      .filter(({ ans }) => reviewFilter === 'all' || (ans && !ans.isRight))
      .map(({ q, i, ans }) => {
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

        return `
          <div class="review-item ${statusCls}">
            <div class="review-question">${i + 1}. ${escapeHtml(String(q.question))}</div>
            <div class="review-answer">
              ${isRight
                ? `<span class="correct-answer">${statusText}</span>`
                : `<span class="wrong-answer">${statusText}</span>${!unanswered ? ` ｜ 你的选择：${OPTION_LABELS[userLabel]}` : ''} ｜ 正确答案：${OPTION_LABELS[correctIdx]}`}
            </div>
            <div class="review-options">${optionsHtml}</div>
            ${expHtml}
          </div>`;
      }).join('');

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
      }
    });

    $('skip-btn').addEventListener('click', skipQuestion);

    $('prev-btn').addEventListener('click', () => {
      if (state.currentIndex > 0) {
        goToQuestion(state.currentIndex - 1);
      }
    });

    $('next-btn').addEventListener('click', () => {
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
      startQuiz();
    });

    $('home-btn').addEventListener('click', () => {
      cleanupQuizSession();
      showPage('home');
      updateStatsUI();
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
    state.isExam = false;
    state.examTimeLeft = 0;
    if (state.reviewMode) {
      state.reviewMode = false;
      delete window.QUIZ_DATA['__wrongbook_review__'];
      state.selectedSubject = null;
      checkStartButton();
    }
  }

  // ===== 导入题库功能 =====

  // 从 localStorage 加载已导入的题库
  function loadImportedBanks() {
    try {
      const saved = localStorage.getItem(IMPORTED_STORAGE_KEY);
      if (saved) {
        const banks = JSON.parse(saved);
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

  // 保存已导入的题库到 localStorage
  function saveImportedBanks() {
    try {
      const banks = {};
      Object.keys(state.importedKeys).forEach(key => {
        if (window.QUIZ_DATA[key]) {
          banks[key] = window.QUIZ_DATA[key];
        }
      });
      localStorage.setItem(IMPORTED_STORAGE_KEY, JSON.stringify(banks));
    } catch (e) {
      console.warn('保存导入题库失败', e);
      showToast('保存失败，存储空间可能不足');
    }
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
    // 校验每道题
    for (let i = 0; i < data.questions.length; i++) {
      const q = data.questions[i];
      if (!q.question || !Array.isArray(q.options) || q.options.length < 2) {
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
    state.importedKeys[data.key] = true;
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
      question: item.question,
      options: item.options,
      answer: item.answer,
      explanation: item.explanation,
      category: item.category
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
    const todayStr = today.toISOString().slice(0, 10);
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
      const dateStr = d2.toISOString().slice(0, 10);
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
  const APP_VERSION = '1.3.10';
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
    if (!isNativeApp() || !cap || typeof cap.nativeCallback !== 'function') return;
    cap.nativeCallback('App', 'backButton', (data) => {
      // 1. 有弹窗（含更新/清理/成就等）或主题背景面板打开 → 先关掉
      if (closeTopOverlay()) return;
      // 2. 答题页：确认后回首页，避免误触丢进度
      if (currentPage === 'quiz') {
        if (window.confirm('确定要退出本次刷题吗？')) showPage('home');
        return;
      }
      // 3. 结果页 → 回首页
      if (currentPage === 'result') { showPage('home'); return; }
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

  function renderPortalList(items) {
    const list = $('portal-list');
    const markers = getPortalMarkers();
    if (!items.length) {
      list.innerHTML = '<div class="portal-empty">仓库的 quizzes/ 目录还没有题库文件，快去发布第一个吧。</div>';
      updatePortalBadge(0);
      return;
    }
    let pending = 0;
    list.innerHTML = items.map((item, idx) => {
      const st = portalItemStatus(item, markers);
      if (st.cls !== 'loaded') pending++;
      const size = item.size ? formatSize(item.size) : '';
      return `
        <div class="portal-item" data-idx="${idx}" data-name="${escapeHtml(item.name)}">
          <div class="portal-item-icon">📄</div>
          <div class="portal-item-info">
            <div class="portal-item-name">${escapeHtml(item.displayName)}</div>
            <div class="portal-item-meta">${size || '&nbsp;'}</div>
          </div>
          <span class="portal-status ${st.cls}">${st.label}</span>
        </div>`;
    }).join('');
    updatePortalBadge(pending);

    list.querySelectorAll('.portal-item').forEach(el => {
      el.addEventListener('click', () => {
        const item = items[parseInt(el.dataset.idx, 10)];
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
            const displayName = base.includes('~') ? base.split('~')[0] : base;
            return { name: f.name, displayName, size: f.size, sha: f.sha, downloadUrl: f.download_url };
          });
        renderPortalList(items);
      })
      .catch(err => {
        list.innerHTML = '<div class="portal-empty">加载失败：' + escapeHtml(err.message) + '<br>请检查网络后点「刷新列表」重试</div>';
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
    loadPortalList(false);
  }

  function closePortalModal() {
    $('portal-modal').style.display = 'none';
  }

  function bindPortalAndUpdateEvents() {
    $('portal-btn').addEventListener('click', openPortalModal);
    $('portal-close-btn').addEventListener('click', closePortalModal);
    $('portal-refresh-btn').addEventListener('click', () => loadPortalList(false));
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
  function init() {
    loadTheme();
    loadCustomBackground();
    loadStats();
    loadXp();
    loadAchievements();
    loadFavorites();
    loadStudyLog();
    loadImportedBanks();
    loadRecycleBin();
    loadWrongBook();
    updateStreak();
    hideDeletedBanks(); // 隐藏已放入回收站的题库
    renderSubjectList();
    renderHomeBadges();
    renderDailyQuote();
    typewriterTitle();
    initSettings();
    bindQuizEvents();
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

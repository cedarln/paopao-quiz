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
    reviewMode: false // 当前是否为错题再练模式
  };

  const OPTION_LABELS = ['A', 'B', 'C', 'D'];
  const IMPORTED_STORAGE_KEY = 'quiz-imported-banks';
  const RECYCLE_BIN_STORAGE = 'quiz-recycle-bin';
  const HIDDEN_KEYS_STORAGE = 'quiz-hidden-keys';
  const WRONG_BOOK_STORAGE = 'quiz-wrong-book';

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

  function showPage(pageName) {
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
    document.querySelectorAll('.subject-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.subject === key);
    });
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

    // 根据模式选择题目
    if (state.mode === 'random' || state.isExam) {
      questions = shuffleArray(questions);
    }

    // 取指定数量的题目
    const qty = Math.min(state.qty, questions.length);
    state.questions = questions.slice(0, qty);
    state.currentIndex = 0;
    state.answers = [];

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

    // 显示结果
    showAnswerResult(index, isRight);

    // 启用下一题按钮
    const nextBtn = $('next-btn');
    nextBtn.disabled = false;
    if (state.currentIndex === state.questions.length - 1) {
      nextBtn.textContent = '查看结果';
    }
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

    // 答题回顾
    renderReview();

    // 收集错题到错题本（错题再练模式下不重复收集）
    if (!state.reviewMode) {
      collectWrongQuestions();
    }

    showPage('result');
  }

  function renderReview() {
    const reviewSection = $('review-section');
    const reviewList = $('review-list');

    if (state.answers.some(a => a && !a.isRight)) {
      reviewSection.style.display = 'block';
      reviewList.innerHTML = '';

      state.questions.forEach((q, i) => {
        const ans = state.answers[i];
        if (!ans || ans.isRight) return;

        const item = document.createElement('div');
        item.className = 'review-item wrong';
        const userAnswer = ans.selected >= 0 ? OPTION_LABELS[ans.selected] : '未作答';
        item.innerHTML = `
          <div class="review-question">${i + 1}. ${q.question}</div>
          <div class="review-answer">
            你的答案：<span class="wrong-answer">${userAnswer}</span> ｜
            正确答案：<span class="correct-answer">${OPTION_LABELS[ans.correct]}</span>
          </div>
        `;
        reviewList.appendChild(item);
      });
    } else {
      reviewSection.style.display = 'none';
    }
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

  // ===== 初始化 =====
  function init() {
    loadStats();
    loadImportedBanks();
    loadRecycleBin();
    loadWrongBook();
    hideDeletedBanks(); // 隐藏已放入回收站的题库
    renderSubjectList();
    initSettings();
    bindQuizEvents();
    bindResultEvents();
    bindImportEvents();
    updateStatsUI();
    updateRecycleBinBadge();
    updateWrongBookBadge();
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// bibit_otech — Client Application Logic

(function () {
  'use strict';

  // --- STATE ---
  const AVATARS = ['🦊', '🚀', '⚡', '🦁', '🐼', '🎮', '🦄', '🍕', '🎯', '🔥', '🏆', '👾', '🎩', '🐯', '🌟'];
  const FUNNY_NICKS = ['СверхРазум', 'Молния', 'КвизКинг', 'ПростоГений', 'Шерлок', 'Нео', 'Капибара', 'ТурбоУтка', 'Эйнштейн', 'Пиксель', 'Магистр', 'КотоФей', 'КиберДракон'];

  let currentUser = {
    nickname: '',
    avatar: '🦊',
    score: 0,
    streak: 0,
    maxStreak: 0,
    correctCount: 0,
    totalTime: 0
  };

  let quizQuestions = [];
  let currentQuestionIndex = 0;
  let questionStartTime = 0;
  let timerInterval = null;
  let hasAnsweredCurrentQuestion = false;
  let leaderboardData = [];

  // Cached DOM elements
  const screens = {
    home: document.getElementById('screen-home'),
    question: document.getElementById('screen-question'),
    roundResult: document.getElementById('screen-round-result'),
    podium: document.getElementById('screen-podium-results')
  };

  const soundBtn = document.getElementById('sound-toggle-btn');
  const soundIcon = document.getElementById('sound-icon');
  const playerBadge = document.getElementById('player-badge');
  const badgeAvatar = document.getElementById('badge-avatar');
  const badgeNick = document.getElementById('badge-nick');
  const badgeScore = document.getElementById('badge-score');
  const avatarDisplay = document.getElementById('assigned-avatar-display');

  // --- INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', () => {
    assignRandomAvatar();
    initUI();
    fetchLeaderboard();
  });

  function assignRandomAvatar() {
    currentUser.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    if (avatarDisplay) {
      avatarDisplay.textContent = currentUser.avatar;
    }
  }

  function initUI() {
    // Sound Toggle
    soundBtn.addEventListener('click', () => {
      const isMuted = window.soundFX.toggleMute();
      soundIcon.textContent = isMuted ? '🔇' : '🔊';
      hapticTap();
    });

    // Logo returns home
    document.getElementById('logo-home-btn').addEventListener('click', () => {
      showScreen('home');
    });

    // Random nickname button
    document.getElementById('random-nick-btn').addEventListener('click', () => {
      const rand = FUNNY_NICKS[Math.floor(Math.random() * FUNNY_NICKS.length)];
      document.getElementById('player-nick-input').value = rand;
      assignRandomAvatar();
      window.soundFX.playTap();
      hapticTap();
    });

    // Start Game Form
    document.getElementById('start-game-form').addEventListener('submit', (e) => {
      e.preventDefault();
      handleStartQuiz();
    });

    // View Leaderboard Button from Home
    document.getElementById('btn-view-leaderboard').addEventListener('click', () => {
      window.soundFX.playTap();
      hapticTap();
      fetchLeaderboard().then(() => {
        showScreen('podium');
      });
    });

    // 4 Answer Buttons (Touch & Click)
    const ansButtons = document.querySelectorAll('.answer-btn');
    ansButtons.forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        createRipple(e, btn);
        handleAnswerSubmit(Number(btn.dataset.index), btn);
      });
    });

    // Next Question Button
    document.getElementById('btn-next-question').addEventListener('click', () => {
      window.soundFX.playTap();
      hapticTap();
      goToNextQuestion();
    });

    // Play Again & Home
    document.getElementById('btn-play-again').addEventListener('click', () => {
      handleStartQuiz();
    });

    document.getElementById('btn-back-home').addEventListener('click', () => {
      showScreen('home');
    });

    // Table search filter
    document.getElementById('table-search-input').addEventListener('input', (e) => {
      filterLeaderboard(e.target.value);
    });

    // Export CSV
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      exportCSV();
    });
  }

  // --- SCREEN SWITCHER ---
  function showScreen(key) {
    Object.keys(screens).forEach((name) => {
      if (screens[name]) {
        screens[name].classList.toggle('active', name === key);
      }
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateBadge() {
    if (currentUser.nickname) {
      playerBadge.classList.remove('hidden');
      badgeAvatar.textContent = currentUser.avatar;
      badgeNick.textContent = currentUser.nickname;
      badgeScore.textContent = currentUser.score;
    } else {
      playerBadge.classList.add('hidden');
    }
  }

  // --- TOUCH & HAPTICS ---
  function hapticTap(ms = 35) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  function hapticCorrect() {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([40, 60, 80]); } catch (e) {}
    }
  }

  function hapticWrong() {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([120]); } catch (e) {}
    }
  }

  function createRipple(event, button) {
    const wave = button.querySelector('.ripple-wave');
    if (!wave) return;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = (event.clientX || (event.touches ? event.touches[0].clientX : rect.left + rect.width / 2)) - rect.left - size / 2;
    const y = (event.clientY || (event.touches ? event.touches[0].clientY : rect.top + rect.height / 2)) - rect.top - size / 2;

    wave.style.width = wave.style.height = `${size}px`;
    wave.style.left = `${x}px`;
    wave.style.top = `${y}px`;
    wave.classList.remove('animate');
    void wave.offsetWidth;
    wave.classList.add('animate');
  }

  // --- 1. START QUIZ ---
  async function handleStartQuiz() {
    const nickInput = document.getElementById('player-nick-input');
    const nick = (nickInput ? nickInput.value : currentUser.nickname).trim();

    if (!nick) {
      alert('Пожалуйста, введи свой никнейм!');
      return;
    }

    currentUser.nickname = nick;
    currentUser.score = 0;
    currentUser.streak = 0;
    currentUser.maxStreak = 0;
    currentUser.correctCount = 0;
    currentUser.totalTime = 0;
    updateBadge();

    window.soundFX.playTap();
    hapticTap();

    try {
      const res = await fetch('/api/active-quiz');
      const data = await res.json();
      quizQuestions = data.questions || [];

      if (quizQuestions.length === 0) {
        alert('В викторине пока нет вопросов!');
        return;
      }

      currentQuestionIndex = 0;
      loadQuestion(currentQuestionIndex);
    } catch (err) {
      console.error('Quiz fetch error:', err);
      alert('Ошибка соединения с сервером');
    }
  }

  // --- 2. LOAD QUESTION ---
  function loadQuestion(index) {
    const q = quizQuestions[index];
    if (!q) {
      finishGameAndShowLeaderboard();
      return;
    }

    hasAnsweredCurrentQuestion = false;
    questionStartTime = Date.now();
    window.soundFX.playWhoosh();

    // Reset buttons
    const ansButtons = document.querySelectorAll('.answer-btn');
    ansButtons.forEach((btn) => {
      btn.classList.remove('selected', 'disabled');
      btn.disabled = false;
    });

    // Populate UI
    document.getElementById('q-counter').textContent = `Вопрос ${index + 1} / ${quizQuestions.length}`;
    document.getElementById('q-text').textContent = q.question;
    document.getElementById('q-streak-count').textContent = `x${currentUser.streak}`;

    for (let i = 0; i < 4; i++) {
      const textEl = document.getElementById(`ans-text-${i}`);
      if (textEl) {
        textEl.textContent = q.options[i] || '';
      }
    }

    showScreen('question');
    startTimer(q.timeLimit || 20);
  }

  function startTimer(seconds) {
    if (timerInterval) clearInterval(timerInterval);

    const circle = document.getElementById('timer-progress-circle');
    const numberEl = document.getElementById('timer-number');
    const circumference = 2 * Math.PI * 44; // 276.46
    circle.style.strokeDasharray = `${circumference} ${circumference}`;

    let remaining = seconds;
    numberEl.textContent = remaining;

    const intervalMs = 100;
    let step = 0;
    circle.style.stroke = '#00e676';

    timerInterval = setInterval(() => {
      step++;
      const timeElapsed = (step * intervalMs) / 1000;
      const timeLeft = Math.max(seconds - timeElapsed, 0);

      numberEl.textContent = Math.ceil(timeLeft);

      const progress = timeLeft / seconds;
      const offset = circumference - progress * circumference;
      circle.style.strokeDashoffset = offset;

      if (progress < 0.25) {
        circle.style.stroke = '#e21b3c';
      } else if (progress < 0.5) {
        circle.style.stroke = '#d89e00';
      }

      // Ticking audio in last 5 seconds
      if (Math.ceil(timeLeft) <= 5 && Math.abs(timeLeft - Math.round(timeLeft)) < 0.08) {
        window.soundFX.playTick();
      }

      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        if (!hasAnsweredCurrentQuestion) {
          handleTimeOut();
        }
      }
    }, intervalMs);
  }

  function handleTimeOut() {
    hasAnsweredCurrentQuestion = true;
    const timeTaken = quizQuestions[currentQuestionIndex].timeLimit || 20;
    sendAnswerCheck(-1, timeTaken);
  }

  // --- 3. SUBMIT ANSWER ---
  async function handleAnswerSubmit(choiceIndex, btn) {
    if (hasAnsweredCurrentQuestion) return;
    hasAnsweredCurrentQuestion = true;

    if (timerInterval) clearInterval(timerInterval);

    const timeTaken = (Date.now() - questionStartTime) / 1000;
    btn.classList.add('selected');
    document.querySelectorAll('.answer-btn').forEach((b) => b.classList.add('disabled'));

    window.soundFX.playTap();
    hapticTap(45);

    await sendAnswerCheck(choiceIndex, timeTaken);
  }

  async function sendAnswerCheck(choiceIndex, timeTaken) {
    const q = quizQuestions[currentQuestionIndex];
    currentUser.totalTime += timeTaken;

    try {
      const res = await fetch('/api/submit-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: q.id,
          choiceIndex,
          timeTaken,
          currentStreak: currentUser.streak
        })
      });
      const data = await res.json();

      if (data.isCorrect) {
        currentUser.score += data.pointsEarned;
        currentUser.streak += 1;
        currentUser.correctCount += 1;
        if (currentUser.streak > currentUser.maxStreak) {
          currentUser.maxStreak = currentUser.streak;
        }
      } else {
        currentUser.streak = 0;
      }
      updateBadge();

      showRoundResultScreen(data.isCorrect, data.pointsEarned, timeTaken);
    } catch (err) {
      console.error('Submit answer error:', err);
    }
  }

  // --- 4. SHOW ROUND RESULT ---
  function showRoundResultScreen(isCorrect, pointsEarned, timeTaken) {
    const icon = document.getElementById('result-status-icon');
    const title = document.getElementById('result-status-title');
    const ptsValue = document.getElementById('result-points-value');
    const streakAlert = document.getElementById('result-streak-alert');
    const streakNum = document.getElementById('result-streak-num');
    const timeEl = document.getElementById('result-time-num');
    const scoreEl = document.getElementById('result-total-score');
    const nextBtnSpan = document.querySelector('#btn-next-question span');

    if (isCorrect) {
      window.soundFX.playCorrect();
      hapticCorrect();
      icon.textContent = '🎉';
      title.textContent = 'Правильно!';
      title.style.color = '#00e676';
      ptsValue.textContent = pointsEarned;
    } else {
      window.soundFX.playWrong();
      hapticWrong();
      icon.textContent = '❌';
      title.textContent = 'Неверно!';
      title.style.color = '#e21b3c';
      ptsValue.textContent = '0';
    }

    if (currentUser.streak >= 2) {
      streakAlert.classList.remove('hidden');
      streakNum.textContent = currentUser.streak;
    } else {
      streakAlert.classList.add('hidden');
    }

    timeEl.textContent = `${timeTaken.toFixed(1)}с`;
    scoreEl.textContent = currentUser.score;

    const isLast = currentQuestionIndex + 1 >= quizQuestions.length;
    if (nextBtnSpan) {
      nextBtnSpan.textContent = isLast ? 'Посмотреть результаты' : 'Следующий вопрос';
    }

    showScreen('roundResult');
  }

  function goToNextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex >= quizQuestions.length) {
      finishGameAndShowLeaderboard();
    } else {
      loadQuestion(currentQuestionIndex);
    }
  }

  // --- 5. FINISH & SAVE RESULT ---
  async function finishGameAndShowLeaderboard() {
    const avgTime = quizQuestions.length > 0 ? (currentUser.totalTime / quizQuestions.length).toFixed(1) : 0;

    try {
      const res = await fetch('/api/save-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: currentUser.nickname,
          avatar: currentUser.avatar,
          score: currentUser.score,
          correctCount: currentUser.correctCount,
          totalQuestions: quizQuestions.length,
          avgTime,
          maxStreak: currentUser.maxStreak
        })
      });
      const data = await res.json();
      leaderboardData = data.leaderboard || [];
    } catch (err) {
      console.error('Save error:', err);
    }

    await fetchLeaderboard();
    window.soundFX.playFanfare();
    showScreen('podium');
    launchConfetti();
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard');
      leaderboardData = await res.json();
      renderPodium(leaderboardData.slice(0, 3));
      renderLeaderboardTable(leaderboardData);
    } catch (err) {
      console.error('Fetch leaderboard error:', err);
    }
  }

  function renderPodium(top3) {
    setPodiumStep(1, top3[0]);
    setPodiumStep(2, top3[1]);
    setPodiumStep(3, top3[2]);
  }

  function setPodiumStep(rank, player) {
    const avatarEl = document.getElementById(`podium-avatar-${rank}`);
    const nameEl = document.getElementById(`podium-name-${rank}`);
    const scoreEl = document.getElementById(`podium-score-${rank}`);

    if (player) {
      avatarEl.textContent = player.avatar || '👑';
      nameEl.textContent = player.nickname;
      scoreEl.textContent = `${player.score} очков`;
    } else {
      avatarEl.textContent = '—';
      nameEl.textContent = 'Пусто';
      scoreEl.textContent = '0 очков';
    }
  }

  function renderLeaderboardTable(data) {
    const tbody = document.getElementById('leaderboard-tbody');
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 24px; color: var(--text-dim); text-align: center;">Пока никто не сыграл. Будь первым!</td></tr>';
      return;
    }

    data.forEach((p, idx) => {
      const rank = p.rank || idx + 1;
      let rankClass = 'table-rank-pill';
      if (rank === 1) rankClass += ' rank-top-1';
      else if (rank === 2) rankClass += ' rank-top-2';
      else if (rank === 3) rankClass += ' rank-top-3';

      const isMe = p.nickname.toLowerCase() === currentUser.nickname.toLowerCase();
      const tr = document.createElement('tr');
      if (isMe) tr.style.background = 'rgba(255, 215, 0, 0.12)';

      tr.innerHTML = `
        <td><div class="${rankClass}">${rank}</div></td>
        <td>
          <div class="table-player-cell">
            <span class="table-player-avatar">${p.avatar || '🦊'}</span>
            <span>${escapeHtml(p.nickname)} ${isMe ? '⭐' : ''}</span>
          </div>
        </td>
        <td><span class="table-score-val">${p.score}</span></td>
        <td>${p.correctCount} / ${p.totalQuestions || 5}</td>
        <td><strong style="color: ${parseInt(p.accuracy) >= 70 ? '#00e676' : '#ffb74d'};">${p.accuracy}</strong></td>
        <td>${p.avgTime}</td>
        <td>${p.maxStreak ? '🔥 ' + p.maxStreak : '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function filterLeaderboard(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      renderLeaderboardTable(leaderboardData);
      return;
    }
    const filtered = leaderboardData.filter((p) =>
      p.nickname.toLowerCase().includes(q)
    );
    renderLeaderboardTable(filtered);
  }

  function exportCSV() {
    if (!leaderboardData || leaderboardData.length === 0) {
      alert('Нет данных для выгрузки');
      return;
    }

    let csv = '\uFEFFМесто;Никнейм;Баллы;Правильно;Всего;Точность;Ср_время;Серия\n';
    leaderboardData.forEach((p, idx) => {
      csv += `${p.rank || idx + 1};"${p.nickname}";${p.score};${p.correctCount};${p.totalQuestions};"${p.accuracy}";"${p.avgTime}";${p.maxStreak || 0}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bibit_otech_results_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // --- CONFETTI ---
  function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#e21b3c', '#1368ce', '#ffd700', '#26890c', '#ff4081', '#00e5ff'];

    for (let i = 0; i < 120; i++) {
      pieces.push({
        x: Math.random() * canvas.width,
        y: Math.random() * -canvas.height,
        size: Math.random() * 8 + 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        speedY: Math.random() * 4 + 2,
        speedX: (Math.random() - 0.5) * 3,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 8
      });
    }

    let frame = 0;
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.y += p.speedY;
        p.x += p.speedX;
        p.rotation += p.rotationSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });

      frame++;
      if (frame < 180) {
        requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    animate();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Load default quizzes
let quizzes = [];
try {
  const data = fs.readFileSync(path.join(__dirname, 'quizzes.json'), 'utf-8');
  quizzes = JSON.parse(data);
} catch (err) {
  console.error('Error reading quizzes.json:', err);
}

// Find local network IPv4 address for phone connections (prioritizing Wi-Fi/LAN)
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && !alias.internal && alias.address !== '127.0.0.1') {
        ips.push(alias.address);
      }
    }
  }
  // Prefer standard home Wi-Fi / LAN IP (192.168.x.x or 10.x.x.x)
  const lanIp = ips.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'));
  return lanIp || ips[0] || 'localhost';
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API endpoints
app.get('/api/info', async (req, res) => {
  const ip = getLocalIp();
  const joinUrl = `http://${ip}:${PORT}`;
  let qrCodeData = '';
  try {
    qrCodeData = await QRCode.toDataURL(joinUrl, { width: 220, margin: 1 });
  } catch (e) {
    console.error('QR error:', e);
  }
  res.json({ ip, port: PORT, joinUrl, qrCode: qrCodeData, quizzes });
});

app.get('/api/quizzes', (req, res) => {
  res.json(quizzes);
});

// Helper to get active questions from questions.json dynamically
function getActiveQuestions() {
  try {
    const qData = fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8');
    return JSON.parse(qData);
  } catch (err) {
    console.error('Error reading questions.json:', err);
    return [];
  }
}

// Persistent Results Helper
function getLeaderboard() {
  try {
    const rData = fs.readFileSync(path.join(__dirname, 'results.json'), 'utf-8');
    return JSON.parse(rData);
  } catch (err) {
    return [];
  }
}

function saveLeaderboard(data) {
  try {
    fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving results.json:', err);
  }
}

// 1. Get Questions for Player (without revealing correct answer)
app.get('/api/active-quiz', (req, res) => {
  const allQ = getActiveQuestions();
  const safeQ = allQ.map((q, idx) => ({
    id: q.id || idx + 1,
    question: q.question,
    options: q.options,
    timeLimit: q.timeLimit || 20
  }));
  res.json({ title: 'bibit_otech', questions: safeQ });
});

// 2. Validate Player Answer & Calculate Kahoot Points
app.post('/api/submit-answer', (req, res) => {
  const { questionId, choiceIndex, timeTaken, currentStreak } = req.body;
  const allQ = getActiveQuestions();
  const q = allQ.find((item, idx) => (item.id || idx + 1) == questionId) || allQ[0];

  if (!q) {
    return res.status(404).json({ error: 'Вопрос не найден' });
  }

  const isCorrect = Number(choiceIndex) === q.correct;
  const timeLimit = q.timeLimit || 20;
  const actualTime = Math.min(Math.max(Number(timeTaken) || 0, 0.1), timeLimit);

  let pointsEarned = 0;
  if (isCorrect) {
    // Classic Kahoot scoring formula:
    // Faster answer = more points, from 1000 down to 500
    const timeRatio = actualTime / timeLimit;
    const basePoints = Math.round(1000 * (1 - (timeRatio / 2)));
    const streak = Number(currentStreak) || 0;
    const streakBonus = streak >= 1 ? Math.min(streak * 75, 400) : 0;
    pointsEarned = basePoints + streakBonus;
  }

  res.json({
    isCorrect,
    correctIndex: q.correct,
    pointsEarned
  });
});

// 3. Save Final Game Result to Persistent Leaderboard
app.post('/api/save-result', (req, res) => {
  const { nickname, avatar, score, correctCount, totalQuestions, avgTime, maxStreak } = req.body;
  const list = getLeaderboard();

  const cleanNick = String(nickname || 'Игрок').trim().slice(0, 16);
  const total = Number(totalQuestions) || 1;
  const correct = Number(correctCount) || 0;
  const accuracy = Math.round((correct / total) * 100);

  const entry = {
    id: 'res_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    nickname: cleanNick,
    avatar: avatar || '🦊',
    score: Number(score) || 0,
    correctCount: correct,
    totalQuestions: total,
    accuracy: `${accuracy}%`,
    avgTime: `${Number(avgTime) || 0}с`,
    maxStreak: Number(maxStreak) || 0,
    date: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  };

  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  saveLeaderboard(list);

  res.json({ success: true, leaderboard: list, myEntry: entry });
});

// 4. Get Current Leaderboard Table
app.get('/api/leaderboard', (req, res) => {
  const list = getLeaderboard();
  list.sort((a, b) => b.score - a.score);
  const ranked = list.map((item, idx) => ({ ...item, rank: idx + 1 }));
  res.json(ranked);
});

// 5. Reset Leaderboard
app.post('/api/clear-leaderboard', (req, res) => {
  saveLeaderboard([]);
  res.json({ success: true });
});

// Rooms State
// pin -> { pin, hostId, quiz, state, currentQ, startTime, timer, players: { socketId: {...} } }
const rooms = new Map();

function generatePin() {
  let pin;
  do {
    pin = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(pin));
  return pin;
}

io.on('connection', (socket) => {
  // HOST: Create room
  socket.on('host:create_room', async ({ quizId, customQuiz }, callback) => {
    let quizToUse = null;
    if (customQuiz && customQuiz.questions && customQuiz.questions.length > 0) {
      quizToUse = customQuiz;
    } else {
      quizToUse = quizzes.find((q) => q.id === quizId) || quizzes[0];
    }

    const pin = generatePin();
    const localIp = getLocalIp();
    const directJoinUrl = `http://${localIp}:${PORT}?pin=${pin}`;
    const qrCode = await QRCode.toDataURL(directJoinUrl, { width: 220, margin: 1 });

    const room = {
      pin,
      hostId: socket.id,
      quiz: quizToUse,
      state: 'lobby', // 'lobby' | 'question' | 'scoreboard' | 'podium'
      currentQ: 0,
      startTime: 0,
      timeLimit: 20,
      timer: null,
      players: new Map()
    };

    rooms.set(pin, room);
    socket.join(pin);
    socket.roomPin = pin;
    socket.isHost = true;

    if (callback) {
      callback({
        success: true,
        pin,
        directJoinUrl,
        qrCode,
        quiz: { title: quizToUse.title, totalQuestions: quizToUse.questions.length }
      });
    }
  });

  // PLAYER: Join room
  socket.on('player:join', ({ pin, nickname, avatar }, callback) => {
    const cleanPin = String(pin || '').trim();
    const room = rooms.get(cleanPin);

    if (!room) {
      return callback && callback({ success: false, message: 'Комната с таким кодом не найдена!' });
    }

    if (room.state !== 'lobby') {
      return callback && callback({ success: false, message: 'Игра в этой комнате уже началась!' });
    }

    const cleanNick = String(nickname || '').trim().slice(0, 15);
    if (!cleanNick) {
      return callback && callback({ success: false, message: 'Введите ваш никнейм!' });
    }

    // Check unique nickname
    for (const player of room.players.values()) {
      if (player.nickname.toLowerCase() === cleanNick.toLowerCase()) {
        return callback && callback({ success: false, message: 'Этот ник уже занят другим игроком!' });
      }
    }

    const player = {
      id: socket.id,
      nickname: cleanNick,
      avatar: avatar || '🦊',
      score: 0,
      streak: 0,
      maxStreak: 0,
      correctCount: 0,
      totalAnswered: 0,
      totalTimeSpent: 0,
      currentAnswer: null
    };

    room.players.set(socket.id, player);
    socket.join(cleanPin);
    socket.roomPin = cleanPin;
    socket.isHost = false;

    // Notify player
    if (callback) {
      callback({
        success: true,
        pin: cleanPin,
        player: { nickname: player.nickname, avatar: player.avatar }
      });
    }

    // Notify host and room
    const playerList = Array.from(room.players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score
    }));

    io.to(room.pin).emit('room:players_update', {
      players: playerList,
      count: playerList.length
    });
  });

  // HOST: Start Game
  socket.on('host:start_game', () => {
    const room = rooms.get(socket.roomPin);
    if (!room || !socket.isHost) return;

    if (room.players.size === 0) {
      socket.emit('host:error', 'Нужен хотя бы 1 игрок для старта!');
      return;
    }

    room.state = 'question';
    room.currentQ = 0;
    sendQuestion(room);
  });

  function sendQuestion(room) {
    const qData = room.quiz.questions[room.currentQ];
    if (!qData) {
      finishGame(room);
      return;
    }

    room.state = 'question';
    room.timeLimit = qData.timeLimit || 20;
    room.startTime = Date.now();

    // Reset current answers for all players
    for (const p of room.players.values()) {
      p.currentAnswer = null;
    }

    // Question object without correct answer for players
    const publicQuestion = {
      index: room.currentQ + 1,
      total: room.quiz.questions.length,
      question: qData.question,
      options: qData.options,
      timeLimit: room.timeLimit
    };

    io.to(room.pin).emit('game:new_question', publicQuestion);

    // Host also gets indicator
    io.to(room.hostId).emit('host:question_live', {
      ...publicQuestion,
      answeredCount: 0,
      totalPlayers: room.players.size
    });

    // Auto timeout on server
    if (room.timer) clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      endCurrentQuestion(room);
    }, (room.timeLimit + 0.5) * 1000);
  }

  // PLAYER: Submit Answer
  socket.on('player:submit_answer', ({ choiceIndex, timeTaken }) => {
    const room = rooms.get(socket.roomPin);
    if (!room || room.state !== 'question') return;

    const player = room.players.get(socket.id);
    if (!player || player.currentAnswer !== null) return; // Already answered

    const qData = room.quiz.questions[room.currentQ];
    const isCorrect = Number(choiceIndex) === qData.correct;
    const actualTime = Math.min(Math.max(Number(timeTaken) || 0, 0.1), room.timeLimit);

    let pointsEarned = 0;
    if (isCorrect) {
      // Kahoot Formula:
      // Base points: 1000 * (1 - (timeTaken / timeLimit) / 2)
      // Instant answer = 1000 pts, last second = 500 pts
      const timeRatio = actualTime / room.timeLimit;
      const basePoints = Math.round(1000 * (1 - (timeRatio / 2)));
      const streakBonus = player.streak >= 1 ? Math.min(player.streak * 75, 400) : 0;
      pointsEarned = basePoints + streakBonus;

      player.score += pointsEarned;
      player.streak += 1;
      if (player.streak > player.maxStreak) player.maxStreak = player.streak;
      player.correctCount += 1;
    } else {
      player.streak = 0;
    }

    player.totalAnswered += 1;
    player.totalTimeSpent += actualTime;
    player.currentAnswer = {
      choiceIndex: Number(choiceIndex),
      timeTaken: actualTime,
      isCorrect,
      pointsEarned
    };

    // Confirm receipt to player
    socket.emit('player:answer_received', {
      received: true,
      choiceIndex
    });

    // Count how many answered
    let answeredCount = 0;
    for (const p of room.players.values()) {
      if (p.currentAnswer !== null) answeredCount++;
    }

    // Send update to host
    io.to(room.hostId).emit('host:answer_count_update', {
      answeredCount,
      totalPlayers: room.players.size
    });

    // If everyone answered, finish question immediately
    if (answeredCount >= room.players.size) {
      if (room.timer) clearTimeout(room.timer);
      setTimeout(() => {
        endCurrentQuestion(room);
      }, 400); // brief tactile pause
    }
  });

  function endCurrentQuestion(room) {
    if (room.state !== 'question') return;
    room.state = 'scoreboard';
    if (room.timer) clearTimeout(room.timer);

    const qData = room.quiz.questions[room.currentQ];
    const correctIndex = qData.correct;

    // Distribution of choices (0, 1, 2, 3)
    const counts = [0, 0, 0, 0];
    for (const p of room.players.values()) {
      if (p.currentAnswer && p.currentAnswer.choiceIndex !== undefined) {
        counts[p.currentAnswer.choiceIndex]++;
      }
    }

    // Rank players
    const sorted = Array.from(room.players.values()).sort((a, b) => b.score - a.score);

    // Send individual results to players
    sorted.forEach((p, idx) => {
      const socket = io.sockets.sockets.get(p.id);
      if (socket) {
        socket.emit('game:question_result', {
          isCorrect: p.currentAnswer ? p.currentAnswer.isCorrect : false,
          correctIndex,
          pointsEarned: p.currentAnswer ? p.currentAnswer.pointsEarned : 0,
          totalScore: p.score,
          streak: p.streak,
          rank: idx + 1,
          totalPlayers: sorted.length
        });
      }
    });

    // Send scoreboard to host & room
    const topLeaderboard = sorted.slice(0, 5).map((p, idx) => ({
      rank: idx + 1,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score,
      streak: p.streak
    }));

    io.to(room.pin).emit('game:question_ended', {
      correctIndex,
      counts,
      topLeaderboard,
      isLastQuestion: room.currentQ + 1 >= room.quiz.questions.length
    });
  }

  // HOST: Next Question
  socket.on('host:next_question', () => {
    const room = rooms.get(socket.roomPin);
    if (!room || !socket.isHost) return;

    room.currentQ++;
    if (room.currentQ >= room.quiz.questions.length) {
      finishGame(room);
    } else {
      sendQuestion(room);
    }
  });

  function finishGame(room) {
    room.state = 'podium';
    if (room.timer) clearTimeout(room.timer);

    const sorted = Array.from(room.players.values()).sort((a, b) => b.score - a.score);

    // Full leaderboard table
    const tableData = sorted.map((p, index) => {
      const avgTime = p.totalAnswered > 0 ? (p.totalTimeSpent / p.totalAnswered).toFixed(1) : 0;
      const accuracy =
        room.quiz.questions.length > 0
          ? Math.round((p.correctCount / room.quiz.questions.length) * 100)
          : 0;

      return {
        rank: index + 1,
        id: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        score: p.score,
        correctCount: p.correctCount,
        totalQuestions: room.quiz.questions.length,
        accuracy: `${accuracy}%`,
        avgTime: `${avgTime}с`,
        maxStreak: p.maxStreak
      };
    });

    io.to(room.pin).emit('game:final_results', {
      podium: tableData.slice(0, 3),
      leaderboard: tableData,
      quizTitle: room.quiz.title
    });
  }

  // Restart game in same room
  socket.on('host:restart_game', () => {
    const room = rooms.get(socket.roomPin);
    if (!room || !socket.isHost) return;

    room.state = 'lobby';
    room.currentQ = 0;
    // reset scores
    for (const p of room.players.values()) {
      p.score = 0;
      p.streak = 0;
      p.maxStreak = 0;
      p.correctCount = 0;
      p.totalAnswered = 0;
      p.totalTimeSpent = 0;
      p.currentAnswer = null;
    }

    const playerList = Array.from(room.players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      score: 0
    }));

    io.to(room.pin).emit('game:restarted', { players: playerList });
  });

  // Handle Disconnect
  socket.on('disconnect', () => {
    if (socket.roomPin) {
      const room = rooms.get(socket.roomPin);
      if (room) {
        if (socket.isHost) {
          // Host left
          io.to(room.pin).emit('room:closed', 'Ведущий завершил игру.');
          rooms.delete(room.pin);
        } else {
          // Player left
          room.players.delete(socket.id);
          const playerList = Array.from(room.players.values()).map((p) => ({
            id: p.id,
            nickname: p.nickname,
            avatar: p.avatar,
            score: p.score
          }));
          io.to(room.pin).emit('room:players_update', {
            players: playerList,
            count: playerList.length
          });
        }
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`Kahoot App running!`);
  console.log(`Local machine:   http://localhost:${PORT}`);
  console.log(`On mobile/WiFi:  http://${localIp}:${PORT}`);
});

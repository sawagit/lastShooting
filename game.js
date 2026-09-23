(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const toastEl = document.getElementById('toast');

  let W = 0, H = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    player.y = H - player.h - 12;
    if (player.x > W - player.w) player.x = W - player.w;
  }

  // --- assets ---
  const playerImg = new Image();
  playerImg.src = 'img/player2.png';
  const enemyImg = new Image();
  enemyImg.src = 'img/front.png';

  const PLAYER_ASPECT = 96 / 178;
  const ENEMY_ASPECT = 1;

  const player = {
    x: 0, y: 0,
    w: 60, h: 60 / PLAYER_ASPECT,
    speed: 240 // px/s
  };

  const enemy = {
    x: 0, y: 0,
    w: 64, h: 64,
    vx: 0,
    targetVx: 0,
    alive: true
  };

  let explosion = null; // {x, y, timer}
  const beams = [];
  const BEAM_W = 8, BEAM_H = 26, BEAM_SPEED = 620;
  const SHOOT_COOLDOWN = 260; // ms
  let lastShotAt = -Infinity;

  const enemyBeams = [];
  const ENEMY_BEAM_W = 8, ENEMY_BEAM_H = 26, ENEMY_BEAM_SPEED = 420;
  const ENEMY_SHOOT_INTERVAL = 3000; // ms
  const ENEMY_SHOOT_SCORE_THRESHOLD = 50;
  const STUN_DURATION = 2000; // ms
  let enemyShootTimer = ENEMY_SHOOT_INTERVAL;
  let playerStunnedUntil = 0;

  let moveLeft = false;
  let moveRight = false;
  let score = 0;
  let hitCount = 0;

  const EARLY_HIT_QUOTES = ['ひとつ！', 'ふたつ！', 'みっつ！', 'よっつ！', 'いつつ！'];
  const MILESTONE_QUOTES = {
    10: 'たった3分で10ラストシューティングだと！',
    20: '連邦の新型は化け物か',
    30: '私にも敵が見える',
    40: '戦いは数だよアニキ',
    50: 'まだだまだ終わらんよ',
    60: '悲しいけどこれ戦争なのよね',
    70: '今計算してみたが・・・',
    80: 'このままだと1000点行くな',
    90: '貴様の頑張りすぎだ',
    100: 'こんなに嬉しいことはない'
  };
  const MILESTONE_QUOTE_POOL = Object.values(MILESTONE_QUOTES);

  let toastHideTimer = null;
  function showToast(text) {
    toastEl.textContent = `👴🏾「${text}」`;
    toastEl.classList.add('show');
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function announceHit(count) {
    if (count <= EARLY_HIT_QUOTES.length) {
      showToast(EARLY_HIT_QUOTES[count - 1]);
      return;
    }
    if (count % 10 !== 0) return;
    const quote = MILESTONE_QUOTES[count] ||
      MILESTONE_QUOTE_POOL[Math.floor(Math.random() * MILESTONE_QUOTE_POOL.length)];
    showToast(quote);
  }

  function resetEnemy() {
    enemy.w = 64; enemy.h = 64;
    enemy.x = Math.random() * (W - enemy.w);
    enemy.y = H * 0.08 + Math.random() * (H * 0.12);
    enemy.vx = 0;
    enemy.targetVx = randTargetVx();
    enemy.alive = true;
  }

  function randTargetVx() {
    const dir = Math.random() < 0.5 ? -1 : 1;
    return dir * (60 + Math.random() * 120);
  }

  let nextEnemyRetargetAt = 0;

  function initGame() {
    player.x = W / 2 - player.w / 2;
    player.y = H - player.h - 12;
    resetEnemy();
    nextEnemyRetargetAt = performance.now() + 1000;
  }

  // --- input ---
  function bindHold(el, onDown, onUp) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', (e) => { e.preventDefault(); onUp(); });
    el.addEventListener('pointercancel', () => onUp());
    el.addEventListener('pointerleave', () => onUp());
  }

  bindHold(document.getElementById('btn-left'), () => moveLeft = true, () => moveLeft = false);
  bindHold(document.getElementById('btn-right'), () => moveRight = true, () => moveRight = false);

  document.getElementById('btn-shoot').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    shoot();
  });

  // keyboard controls (PC): ArrowLeft/ArrowRight to move, ArrowUp to shoot
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); moveLeft = true; }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveRight = true; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); shoot(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') moveLeft = false;
    else if (e.key === 'ArrowRight') moveRight = false;
  });

  function shoot() {
    const now = performance.now();
    if (now - lastShotAt < SHOOT_COOLDOWN) return;
    lastShotAt = now;
    beams.push({
      x: player.x + player.w * 0.22 - BEAM_W / 2,
      y: player.y + player.h * 0.05,
      w: BEAM_W,
      h: BEAM_H
    });
  }

  function setScore(v) {
    score = v;
    scoreEl.textContent = String(score);
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function getEnemyShootInterval(currentScore) {
    const tier = Math.floor(currentScore / 100);
    return Math.max(300, ENEMY_SHOOT_INTERVAL * Math.pow(0.8, tier));
  }

  function vibrateStun() {
    if (navigator.vibrate) {
      // buzzes on/off for roughly the STUN_DURATION (2s)
      navigator.vibrate([250, 100, 250, 100, 250, 100, 250, 100, 250, 100, 250]);
    }
  }

  let lastTs = 0;
  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    update(ts, dt);
    draw();

    requestAnimationFrame(loop);
  }

  function update(ts, dt) {
    const stunned = ts < playerStunnedUntil;

    // player movement (disabled while stunned)
    if (!stunned) {
      if (moveLeft && !moveRight) player.x -= player.speed * dt;
      if (moveRight && !moveLeft) player.x += player.speed * dt;
      player.x = Math.max(0, Math.min(W - player.w, player.x));
    }

    // enemy flutter movement
    if (ts >= nextEnemyRetargetAt) {
      enemy.targetVx = randTargetVx();
      nextEnemyRetargetAt = ts + 700 + Math.random() * 900;
    }
    enemy.vx += (enemy.targetVx - enemy.vx) * Math.min(1, dt * 2.5);
    if (enemy.alive) {
      enemy.x += enemy.vx * dt;
      if (enemy.x < 0) { enemy.x = 0; enemy.targetVx = Math.abs(enemy.targetVx); }
      if (enemy.x > W - enemy.w) { enemy.x = W - enemy.w; enemy.targetVx = -Math.abs(enemy.targetVx); }
    }

    // beams
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      b.y -= BEAM_SPEED * dt;
      if (b.y + b.h < 0) {
        beams.splice(i, 1);
        continue;
      }
      if (enemy.alive && rectsOverlap(b, enemy)) {
        beams.splice(i, 1);
        killEnemy();
      }
    }

    // enemy mouth-beam attack (unlocked once score exceeds threshold);
    // interval gets 20% shorter for every 100 points scored beyond that
    enemyShootTimer -= dt * 1000;
    if (enemyShootTimer <= 0) {
      enemyShootTimer = getEnemyShootInterval(score);
      if (score > ENEMY_SHOOT_SCORE_THRESHOLD && enemy.alive) {
        enemyBeams.push({
          x: enemy.x + enemy.w / 2 - ENEMY_BEAM_W / 2,
          y: enemy.y + enemy.h * 0.8,
          w: ENEMY_BEAM_W,
          h: ENEMY_BEAM_H
        });
      }
    }

    const playerRect = { x: player.x, y: player.y, w: player.w, h: player.h };
    for (let i = enemyBeams.length - 1; i >= 0; i--) {
      const b = enemyBeams[i];
      b.y += ENEMY_BEAM_SPEED * dt;
      if (b.y > H) {
        enemyBeams.splice(i, 1);
        continue;
      }
      if (rectsOverlap(b, playerRect)) {
        enemyBeams.splice(i, 1);
        playerStunnedUntil = ts + STUN_DURATION;
        vibrateStun();
      }
    }

    // explosion timer
    if (explosion) {
      explosion.timer -= dt * 1000;
      if (explosion.timer <= 0) explosion = null;
    }
  }

  function killEnemy() {
    enemy.alive = false;
    explosion = {
      x: enemy.x + enemy.w / 2,
      y: enemy.y + enemy.h / 2,
      timer: 400
    };
    setScore(score + 10);
    hitCount += 1;
    announceHit(hitCount);
    setTimeout(resetEnemy, 450);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // player (shakes while stunned)
    if (playerImg.complete && playerImg.naturalWidth) {
      const stunned = performance.now() < playerStunnedUntil;
      const shakeX = stunned ? (Math.random() - 0.5) * 10 : 0;
      const shakeY = stunned ? (Math.random() - 0.5) * 10 : 0;
      ctx.drawImage(playerImg, player.x + shakeX, player.y + shakeY, player.w, player.h);
    }

    // enemy
    if (enemy.alive && enemyImg.complete && enemyImg.naturalWidth) {
      ctx.drawImage(enemyImg, enemy.x, enemy.y, enemy.w, enemy.h);
    }

    // beams (pink)
    for (const b of beams) {
      ctx.save();
      ctx.shadowColor = '#ff5fe0';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ff3fd8';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }

    // enemy beams (red)
    for (const b of enemyBeams) {
      ctx.save();
      ctx.shadowColor = '#ff6666';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ff2222';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }

    // explosion
    if (explosion) {
      ctx.save();
      ctx.font = '48px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💥', explosion.x, explosion.y);
      ctx.restore();
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 100));

  resize();
  initGame();
  requestAnimationFrame(loop);
})();

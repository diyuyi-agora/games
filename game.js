(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const W = 1200, H = 680, FLOOR = 514;
  const fxNames = ['hitstop', 'reaction', 'shake', 'particles', 'audio'];
  const effects = Object.fromEntries(fxNames.map(k => [k, true]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) { effects.shake = false; $('fx-shake').checked = false; }
  const keys = new Set(), touchKeys = new Set();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  let intensity = 1, audioContext, master, noiseBuffer;
  let player, enemy, particles, floats, ghosts, attack, queued;
  let time = 0, lastTime = 0, freeze = 0, shake = 0, totalHits = 0;
  let combo = 0, comboAge = 0, chain = 0, chainAge = 0, messageAge = 0;
  let challenge = false, remaining = 30, kills = 0, damageTotal = 0, finished = false;
  let hitFlash = 0, uiTimer = 0, audioEnabled = false;
  let viewWidth = W, cameraX = 0;
  const LIGHTS = [
    { duration: .32, contact: .105, damage: 12, range: 179, knock: 19, stop: .045, stun: .23 },
    { duration: .33, contact: .115, damage: 14, range: 188, knock: 22, stop: .055, stun: .25 },
    { duration: .44, contact: .17, damage: 21, range: 198, knock: 35, stop: .075, stun: .34 }
  ];
  const HEAVY = { duration: .79, contact: .35, damage: 42, range: 221, knock: 71, stop: .11, stun: .73 };

  function initAudio() {
    if (!effects.audio) return;
    try {
      if (!audioContext) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        audioContext = new AudioCtor();
        master = audioContext.createGain(); master.gain.value = .48; master.connect(audioContext.destination);
        noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      audioEnabled = true;
    } catch (_) { audioEnabled = false; }
  }
  function tone(freq, endFreq, duration, volume, type = 'sine', delay = 0) {
    const t = audioContext.currentTime + delay, osc = audioContext.createOscillator(), gain = audioContext.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t); osc.frequency.exponentialRampToValueAtTime(Math.max(15, endFreq), t + duration);
    gain.gain.setValueAtTime(.001, t); gain.gain.linearRampToValueAtTime(volume, t + .004); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); gain.connect(master); osc.start(t); osc.stop(t + duration + .02);
  }
  function noise(duration, freq, volume) {
    const t = audioContext.currentTime, source = audioContext.createBufferSource(), filter = audioContext.createBiquadFilter(), gain = audioContext.createGain();
    source.buffer = noiseBuffer; filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = .7;
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    source.connect(filter); filter.connect(gain); gain.connect(master); source.start(t); source.stop(t + duration);
  }
  function sound(kind) {
    if (!effects.audio || !audioEnabled || !audioContext || audioContext.state !== 'running') return;
    const v = Math.min(intensity, 1.3);
    if (kind === 'swing') { noise(.09, 1600, .16 * v); return; }
    if (kind === 'dash') { noise(.15, 900, .13 * v); return; }
    if (kind === 'hurt') { tone(160, 45, .19, .28, 'triangle'); noise(.15, 400, .17); return; }
    if (kind === 'break') { tone(270, 55, .25, .3 * v, 'triangle'); noise(.3, 2400, .22 * v); tone(620, 170, .3, .09 * v, 'sine', .03); return; }
    const heavy = kind === 'heavy';
    tone(heavy ? 115 : 180, 35, heavy ? .25 : .12, .4 * v, 'sine');
    noise(heavy ? .2 : .1, enemy.armored ? 3000 : 1800, .32 * v);
    tone(enemy.armored ? 640 : 390, enemy.armored ? 250 : 140, .13, .08 * v, 'triangle');
  }

  function resetScene(startChallenge = false) {
    challenge = startChallenge; remaining = 30; kills = 0; damageTotal = 0; finished = false;
    player = { x: 565, facing: 1, move: 0, hp: 5, dash: 0, dashCD: 0, hurt: 0, invincible: 0, walk: 0 };
    enemy = newEnemy(758);
    particles = []; floats = []; ghosts = []; attack = null; queued = null;
    freeze = 0; shake = 0; totalHits = 0; combo = 0; comboAge = 0; chain = 0; chainAge = 0;
    hitFlash = 0; keys.clear(); touchKeys.clear();
    document.querySelectorAll('.key-button').forEach(b => b.classList.remove('held'));
    $('result-overlay').hidden = true;
    $('mode-label').textContent = challenge ? '30 秒试炼' : '自由练习';
    $('challenge-button').innerHTML = challenge ? '结束试炼 <span>↗</span>' : '开始 30 秒试炼 <span>↗</span>';
    $('last-hit').innerHTML = '等待挥剑<span>—</span>';
    $('damage-value').innerHTML = '—<small>伤害</small>';
    $('stop-value').innerHTML = '—<small>ms</small>';
    $('arena-hint').textContent = challenge ? '橙色预警即将攻击 · 空格闪避，J / K 反击' : '按 J 打出第一击；用 B 对比两种反馈';
    say(challenge ? '试炼开始 · 闪避红色预警，再反击' : '', challenge ? 2.1 : 0);
    updateHUD();
    if (startChallenge) $('arena').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }
  function newEnemy(x) {
    const armored = $('target-type').value === 'armor';
    return { x, home: x, hp: armored ? 240 : 180, maxHP: armored ? 240 : 180, armored, armor: armored ? 3 : 0, stun: 0, flash: 0, recoil: 0, dead: 0, respawn: 0, state: 'idle', stateTime: 0, cooldown: 1.6, facing: -1, hit: false, walk: 0 };
  }
  function say(text, duration = 1.7) { $('arena-message').textContent = text; messageAge = duration; }
  function updatePresets() {
    const all = fxNames.every(k => effects[k]), none = fxNames.every(k => !effects[k]);
    $('preset-full').classList.toggle('selected', all); $('preset-raw').classList.toggle('selected', none);
    $('preset-full').setAttribute('aria-pressed', String(all)); $('preset-raw').setAttribute('aria-pressed', String(none));
    $('arena-mode').innerHTML = `${all ? '完整反馈' : none ? '原始反馈' : '自定义反馈'} <span>${none ? 'OFF' : 'ON'}</span>`;
    $('arena-mode').classList.toggle('raw', none);
    $('preset-description').textContent = none ? '保留伤害、位移与硬直，只留下最基础的命中提示。' : all ? '相同的伤害与规则，感受更清晰的力量传递。' : '逐项改变反馈，找出让你觉得「有力」的关键。';
  }
  function preset(full) {
    fxNames.forEach(k => { effects[k] = full; $('fx-' + k).checked = full; });
    if (full) initAudio();
    updatePresets();
  }
  function attackRequest(kind) {
    if (finished) return;
    initAudio();
    if (attack || player.dash > 0 || player.hurt > .12) { queued = { kind, life: .24 }; return; }
    startAttack(kind);
  }
  function startAttack(kind) {
    if (kind === 'dash') { dash(); return; }
    const heavy = kind === 'heavy';
    if (!heavy) { if (chainAge > .85) chain = 0; chain = chain % 3 + 1; chainAge = 0; }
    const info = heavy ? HEAVY : LIGHTS[chain - 1];
    attack = { kind, index: heavy ? 0 : chain, t: 0, hit: false, swung: false, ...info };
    player.move = 0;
    $('arena-hint').textContent = heavy ? '蓄势 → 释放 → 接触 → 余势' : '连续按 J 衔接三连击；K 重击制造节奏重音';
  }
  function dash() {
    if (player.dashCD > 0 || finished || player.hurt > .12) return;
    attack = null; queued = null;
    player.dash = .19; player.dashCD = .66; player.invincible = .27;
    sound('dash');
  }
  function impact() {
    const a = attack;
    if (!a || enemy.dead) return;
    const distance = (enemy.x - player.x) * player.facing;
    if (distance < -28 || distance > a.range) {
      $('last-hit').innerHTML = `${a.kind === 'heavy' ? '重击' : '轻击'}挥空<span>MISS</span>`;
      $('damage-value').innerHTML = '0<small>伤害</small>';
      $('stop-value').innerHTML = '0<small>ms</small>';
      return;
    }
    const heavy = a.kind === 'heavy', armorActive = enemy.armored && enemy.armor > 0;
    let broken = false;
    if (armorActive && heavy) { enemy.armor--; broken = enemy.armor === 0; }
    const resisted = armorActive && !broken;
    const damage = resisted ? Math.round(a.damage * .55) : a.damage;
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.flash = .15; enemy.recoil = heavy ? 1.2 : .65;
    enemy.stun = resisted ? .035 : a.stun;
    // Displacement and stun are combat rules, identical in both presentation presets.
    enemy.x = clamp(enemy.x + player.facing * a.knock * (resisted ? .22 : 1), 95, 1100);
    if (!resisted) { enemy.state = 'idle'; enemy.stateTime = 0; enemy.cooldown = Math.max(enemy.cooldown, .7); }
    totalHits++; combo++; comboAge = 0; damageTotal += damage;
    const actualStop = effects.hitstop ? a.stop * intensity : 0;
    freeze = Math.min(.16, actualStop);
    if (effects.shake) shake = (heavy ? 12 : a.index === 3 ? 7 : 4) * intensity;
    hitFlash = .13;
    const cx = enemy.x - player.facing * 28, cy = FLOOR - 80;
    if (effects.particles) {
      burst(cx, cy, heavy ? 26 : 13, heavy ? '#fff3c0' : '#e9f4d4', player.facing, heavy ? 1.6 : 1);
      burst(cx, cy + 8, heavy ? 14 : 6, '#dd8246', player.facing, 1);
      particles.push({ kind: 'ring', x: cx, y: cy, life: .24, max: .24, radius: heavy ? 110 : 65, color: '#f4f2ce' });
    }
    floats.push({ x: enemy.x, y: FLOOR - 171, text: String(damage), life: .85, max: .85, color: heavy ? '#fff1be' : '#f1f6e7', heavy });
    $('last-hit').innerHTML = `${broken ? '装甲击破' : resisted ? '装甲承受' : heavy ? '重击命中' : ['轻击 · 一式', '轻击 · 二式', '轻击 · 三式'][a.index - 1]}<span>${broken ? 'BREAK' : heavy ? 'HEAVY' : 'LIGHT'}</span>`;
    $('damage-value').innerHTML = `${damage}<small>伤害</small>`;
    $('stop-value').innerHTML = `${Math.round(freeze * 1000)}<small>ms</small>`;
    document.querySelector('.signal-icon').classList.add('pulse');
    if (broken) { say('装甲击破 · 现在可以打断它'); sound('break'); }
    else sound(heavy ? 'heavy' : 'light');
    if (resisted) $('arena-hint').textContent = `装甲承受轻击 · 再用 ${enemy.armor} 次重击破防`;
    if (enemy.hp <= 0) {
      enemy.dead = 1; enemy.respawn = 1.15; enemy.state = 'idle'; kills++;
      if (effects.particles) burst(enemy.x, FLOOR - 70, 36, '#d6dbac', player.facing, 1.9);
      if (!broken) say(challenge ? `击破 ${kills} · 继续！` : '击破 · 机兵即将重置', 1);
      sound('break');
    }
    updateHUD();
  }
  function burst(x, y, count, color, dir, power) {
    count = Math.round(count * intensity);
    for (let i = 0; i < count; i++) {
      const life = rand(.19, .53);
      particles.push({ kind: 'spark', x, y, vx: dir * rand(-90, 440) * power, vy: rand(-270, 130) * power, life, max: life, size: rand(1.5, 4) * power, color });
    }
  }
  function hurtPlayer() {
    if (player.invincible > 0 || finished) return;
    player.hp--; player.hurt = .32; player.invincible = .85;
    player.x = clamp(player.x + enemy.facing * 65, 85, 1110);
    attack = null; queued = null; combo = 0;
    if (effects.shake) shake = 8 * intensity;
    if (effects.particles) burst(player.x, FLOOR - 70, 12, '#ec8d5a', enemy.facing, 1);
    sound('hurt'); say('按空格闪过预警攻击', 1.2);
    updateHUD();
    if (player.hp <= 0) endChallenge(false);
  }
  function endChallenge(survived) {
    challenge = false; finished = true; attack = null; queued = null; keys.clear(); touchKeys.clear();
    document.querySelectorAll('.key-button').forEach(b => b.classList.remove('held'));
    $('mode-label').textContent = '试炼结束';
    $('result-title').textContent = survived ? '试炼完成，漂亮。' : '调整节奏，再来一次。';
    $('result-copy').textContent = `击破 ${kills} 台机兵 · ${totalHits} 次命中\n累计伤害 ${damageTotal} · 剩余生命 ${player.hp}/5`;
    $('result-overlay').hidden = false;
    $('challenge-button').innerHTML = '开始 30 秒试炼 <span>↗</span>';
  }

  function updateHUD() {
    $('hits-value').innerHTML = `${String(totalHits).padStart(2, '0')}<small>命中</small>`;
    $('combo-count').textContent = combo;
    $('combo-hud').classList.toggle('active', combo > 1 && comboAge < 2.5);
    $('target-name').textContent = enemy.armored ? enemy.armor > 0 ? `装甲机兵 · ${enemy.armor}层` : '机兵 · 已破甲' : '训练机兵';
    $('target-health-text').textContent = `${enemy.hp} / ${enemy.maxHP}`;
    $('target-health-bar').style.width = `${enemy.hp / enemy.maxHP * 100}%`;
    const targetHUD = document.querySelector('.target-hud');
    targetHUD.style.left = `${clamp((enemy.x - cameraX) / viewWidth * 100 - 8.5, 5, 76)}%`;
    targetHUD.style.top = '37%';
    targetHUD.style.opacity = enemy.dead ? '0' : '1';
    $('player-health').setAttribute('aria-label', `玩家生命值 ${player.hp}`);
    [...$('player-health').children].forEach((el, i) => el.classList.toggle('empty', i >= player.hp));
    $('arena-clock').textContent = challenge ? `${Math.ceil(remaining).toString().padStart(2, '0')} SEC / ${kills} BREAKS` : finished ? 'SESSION COMPLETE' : '∞ FREE PLAY';
  }
  function update(dt) {
    time += dt;
    if (messageAge > 0) { messageAge -= dt; if (messageAge <= 0) $('arena-message').textContent = ''; }
    if (challenge) { remaining = Math.max(0, remaining - dt); if (remaining === 0) endChallenge(true); }
    comboAge += dt; chainAge += dt;
    if (comboAge > 2.5) { combo = 0; $('combo-hud').classList.remove('active'); }
    hitFlash = Math.max(0, hitFlash - dt);
    shake = Math.max(0, shake - dt * 55);
    particles.forEach(p => { p.life -= dt; if (p.kind === 'spark') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 650 * dt; p.vx *= 1 - dt * 2; } });
    particles = particles.filter(p => p.life > 0);
    floats.forEach(f => { f.life -= dt; f.y -= dt * 54; }); floats = floats.filter(f => f.life > 0);
    ghosts.forEach(g => g.life -= dt); ghosts = ghosts.filter(g => g.life > 0);
    uiTimer += dt;
    if (uiTimer > .08) { updateHUD(); uiTimer = 0; }
    if (freeze > 0) { freeze -= dt; return; }
    if (finished) return;
    player.dashCD = Math.max(0, player.dashCD - dt); player.hurt = Math.max(0, player.hurt - dt); player.invincible = Math.max(0, player.invincible - dt);
    if (queued) { queued.life -= dt; if (queued.life <= 0) queued = null; }
    const left = keys.has('a') || keys.has('arrowleft') || touchKeys.has('left');
    const right = keys.has('d') || keys.has('arrowright') || touchKeys.has('right');
    const movement = Number(right) - Number(left);
    if (player.dash > 0) {
      player.dash = Math.max(0, player.dash - dt);
      player.x += player.facing * 890 * dt;
      if (effects.particles && ghosts.length < 7) ghosts.push({ x: player.x, facing: player.facing, life: .16 });
    } else if (!attack && player.hurt <= 0) {
      player.move = movement;
      if (movement) { player.facing = movement; player.x += movement * 290 * dt; player.walk += dt * 13; }
      if (queued) { const kind = queued.kind; queued = null; startAttack(kind); }
    }
    player.x = clamp(player.x, 80, 1110);
    if (attack) {
      const prev = attack.t; attack.t += dt;
      if (attack.t >= attack.contact - .055 && !attack.swung) { sound('swing'); attack.swung = true; }
      if (attack.t > attack.contact - .075 && attack.t < attack.contact + .045) player.x = clamp(player.x + player.facing * (attack.kind === 'heavy' ? 390 : 270) * dt, 80, 1110);
      if (prev < attack.contact && attack.t >= attack.contact && !attack.hit) { attack.hit = true; impact(); }
      if (attack && attack.t >= attack.duration) attack = null;
    }
    if (enemy.dead) {
      enemy.respawn -= dt;
      if (enemy.respawn <= 0) {
        const spawn = player.x < 650 ? clamp(player.x + 230, 280, 1000) : clamp(player.x - 230, 200, 950);
        enemy = newEnemy(spawn);
      }
      return;
    }
    enemy.stun = Math.max(0, enemy.stun - dt); enemy.flash = Math.max(0, enemy.flash - dt); enemy.recoil *= Math.max(0, 1 - dt * 12);
    if (challenge && enemy.stun <= 0) {
      const delta = player.x - enemy.x;
      if (enemy.state === 'idle') {
        enemy.facing = delta >= 0 ? 1 : -1;
        enemy.cooldown -= dt;
        if (Math.abs(delta) > 164) { enemy.x += enemy.facing * 100 * dt; enemy.walk += dt * 8; }
        else if (enemy.cooldown <= 0) { enemy.state = 'windup'; enemy.stateTime = 0; enemy.hit = false; }
      } else if (enemy.state === 'windup') {
        enemy.stateTime += dt;
        if (enemy.stateTime >= .72) { enemy.state = 'strike'; enemy.stateTime = 0; }
      } else if (enemy.state === 'strike') {
        enemy.stateTime += dt;
        if (enemy.stateTime < .1) enemy.x = clamp(enemy.x + enemy.facing * 380 * dt, 80, 1110);
        if (enemy.stateTime > .08 && !enemy.hit) {
          enemy.hit = true;
          if ((player.x - enemy.x) * enemy.facing > -40 && (player.x - enemy.x) * enemy.facing < 190) hurtPlayer();
        }
        if (enemy.stateTime > .52) { enemy.state = 'idle'; enemy.cooldown = 1.15; }
      }
    } else if (!challenge && enemy.stun <= 0) {
      enemy.x = lerp(enemy.x, enemy.home, dt * .65);
    }
  }

  // All art is drawn locally: no textures, fonts, network requests or asset loading.
  function poly(points, color, stroke, width = 1) {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    if (color) { ctx.fillStyle = color; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }
  function line(points, color, width = 1) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function ellipse(x, y, rx, ry, color) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
  function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
  function background() {
    const sky = ctx.createLinearGradient(0, 0, 0, 680); sky.addColorStop(0, '#dce0cd'); sky.addColorStop(.6, '#b8c7a9'); sky.addColorStop(1, '#7b967e');
    rect(0, 0, W, H, sky);
    ellipse(860, 170, 205, 205, '#e2e6d065'); ellipse(860, 170, 150, 150, '#e9ecd94d');
    // Architectural silhouettes, haze and overgrown stonework.
    poly([[0, 324], [115, 255], [210, 282], [310, 221], [431, 281], [560, 230], [675, 303], [790, 246], [935, 290], [1050, 240], [1200, 290], [1200, 520], [0, 520]], '#9db29755');
    for (let i = 0; i < 10; i++) {
      const x = i * 153 - 35, h = 85 + (i % 3) * 35;
      rect(x, 352 - h, 72, h + 110, '#91a68b35'); rect(x + 7, 346 - h, 58, 7, '#a4b79a60');
      rect(x + 13, 362 - h, 4, h, '#bed0ad35');
    }
    poly([[0, 416], [100, 402], [208, 415], [328, 393], [418, 416], [542, 401], [653, 416], [789, 390], [911, 410], [1004, 389], [1200, 410], [1200, 550], [0, 550]], '#87a08666');
    // Left broken arch.
    rect(78, 234, 57, 268, '#7f967b'); rect(84, 237, 8, 265, '#a4b393'); rect(131, 245, 9, 253, '#6b866e');
    rect(69, 219, 78, 19, '#9eae8c'); rect(65, 209, 88, 12, '#b5bea0');
    poly([[78, 209], [98, 145], [151, 116], [218, 110], [225, 124], [170, 137], [136, 167], [130, 208]], '#acb89a');
    poly([[80, 209], [101, 149], [153, 119], [218, 113], [217, 126], [154, 137], [117, 167], [103, 209]], '#c5cbb0');
    rect(69, 482, 82, 22, '#69866d'); rect(62, 499, 96, 15, '#54725b');
    [[280, 440, 44, 64], [327, 459, 33, 45], [1025, 423, 51, 84], [1081, 446, 34, 60]].forEach(([x,y,w,h]) => { rect(x,y,w,h,'#829577'); rect(x,y,w,8,'#a6b291'); rect(x+5,y+13,4,h-13,'#9caa8a'); });
    // Tall right monolith, hanging pennant and small orange markers.
    poly([[1081, 140], [1124, 129], [1148, 152], [1145, 507], [1084, 507]], '#6f896f');
    poly([[1081, 140], [1100, 147], [1102, 506], [1084, 507]], '#8da083');
    line([[1115, 159], [1119, 295], [1108, 320], [1119, 371]], '#a0b08b', 2);
    rect(1065, 488, 95, 23, '#607e62');
    rect(979, 222, 5, 264, '#5c775d'); line([[981, 225], [1042, 225]], '#5b7255', 4);
    poly([[990, 229], [1042, 229], [1037, 336], [1016, 325], [992, 341]], '#b46c44');
    poly([[998, 230], [1006, 230], [1006, 330], [998, 337]], '#cd8b58');
    line([[1015, 252], [1027, 274], [1015, 296]], '#dfb58090', 2);
    for (let i = 0; i < 15; i++) {
      const x = (i * 107 + 28 + time * (2 + i % 3)) % W, y = 145 + (i * 57) % 300 + Math.sin(time * .5 + i) * 10;
      ellipse(x, y, 1.5, 1.5, '#eff1cb65');
    }
    // Ground slab and depth below the platform.
    poly([[0, 503], [160, 506], [298, 500], [428, 504], [587, 500], [739, 505], [920, 498], [1090, 503], [1200, 499], [1200, 680], [0, 680]], '#2e503f');
    rect(0, 510, W, 12, '#6e8961'); rect(0, 519, W, 4, '#233e31');
    const ground = ctx.createLinearGradient(0, 523, 0, 680); ground.addColorStop(0, '#365743'); ground.addColorStop(1, '#203d32'); rect(0, 523, W, 157, ground);
    for (let i = 0; i < 13; i++) {
      let x = i * 108 - 22;
      line([[x, 525], [x + 9, 551], [x + 3, 573]], '#192f293b', 2);
      line([[x + 4, 566], [x + 100, 566]], '#8ba07712', 1);
      line([[x + 55, 570], [x + 52, 606]], '#172f2929', 2);
    }
    for (let i = 0; i < 70; i++) {
      const x = (i * 73 + 19) % 1200, y = 504 + (i * 13) % 8, h = 4 + i % 11;
      line([[x - 3, y], [x, y - h], [x + 1, y]], i % 3 === 0 ? '#b2bc85' : '#779368', 1.4);
    }
    [[172,506,22,9],[375,506,16,6],[947,505,20,8],[1136,504,28,11]].forEach(([x,y,w,h]) => { ellipse(x,y,w,h,'#536e51'); poly([[x-w,y],[x-w*.4,y-h],[x+w*.5,y-h*.8],[x+w,y]],'#94a27b'); });
    // Foreground grass frames the playable space.
    for (let i = 0; i < 20; i++) {
      const x = i < 10 ? i * 10 - 12 : 1118 + (i - 10) * 11;
      const y = 583 + (i % 4) * 8;
      poly([[x-6,y+30],[x-14,y-12],[x+2,y+7],[x+8,y-29],[x+11,y+12],[x+25,y-7],[x+15,y+30]], '#254634');
    }
    // Sparse registration marks give the scene an experimental field-note feel.
    line([[34, 278], [34, 293]], '#607d5c40'); line([[27, 286], [41, 286]], '#607d5c40');
    line([[1163, 367], [1163, 382]], '#607d5c40'); line([[1156, 375], [1170, 375]], '#607d5c40');
  }

  function drawPlayer(x = player.x, dir = player.facing, ghost = false) {
    const moving = player.move && !attack && player.dash <= 0;
    const stride = moving ? Math.sin(player.walk) * 10 : 0;
    const bob = moving ? Math.abs(Math.cos(player.walk)) * 3 : Math.sin(time * 2.7) * 1.6;
    if (!ghost) ellipse(x, FLOOR + 3, player.dash > 0 ? 44 : 29, 6, '#142e2e45');
    ctx.save(); ctx.translate(x, FLOOR + bob); ctx.scale(dir, 1);
    if (player.dash > 0) ctx.transform(1, 0, -.2, 1, 0, 0);
    if (player.hurt > 0) ctx.rotate(-.18);
    if (!ghost && player.invincible > .25 && Math.floor(time * 22) % 2 === 0) ctx.globalAlpha = .55;
    const white = player.hurt > .2 ? '#e9ac89' : '#edeeda';
    // Legs, boots, jacket and shoulder plate.
    poly([[-14,-44],[-2,-43],[-5+stride,-9],[-18+stride,-7]], '#334f48');
    poly([[1,-43],[13,-42],[18-stride,-9],[4-stride,-7]], '#4b6257');
    poly([[-19+stride,-11],[-5+stride,-11],[-3+stride,-2],[-24+stride,-2]], '#243e39');
    poly([[3-stride,-11],[19-stride,-10],[25-stride,-3],[3-stride,-2]], '#2c4740');
    poly([[-18,-85],[11,-89],[20,-62],[13,-38],[-16,-38],[-24,-65]], '#d5ddc2');
    poly([[-18,-84],[-9,-82],[-8,-42],[-17,-39],[-24,-65]], '#a2b39d');
    rect(-17,-47,32,7,'#3e5144'); rect(-1,-47,7,7,'#c29356');
    poly([[-23,-83],[-11,-88],[-5,-71],[-17,-64],[-27,-68]], white);
    // Scarf catches movement and the swing's acceleration.
    const flutter = Math.sin(time * 7) * 4 + (attack ? -8 : 0);
    poly([[-12,-96],[-25,-92],[-48,-91+flutter],[-61,-99+flutter],[-32,-103],[-15,-106]], '#cf6840');
    poly([[-34,-97],[-54,-100+flutter],[-44,-104+flutter]], '#e09358');
    // Angular closed helmet and a dark visor.
    poly([[-17,-123],[-4,-132],[15,-125],[22,-105],[13,-92],[-12,-94],[-21,-107]], white);
    poly([[-17,-123],[-8,-123],[-11,-100],[-16,-96],[-21,-107]], '#acbba3');
    poly([[1,-117],[20,-114],[21,-107],[2,-109]], '#314c42');
    line([[6,-113],[17,-111]], '#a6c9b1', 1.7);
    poly([[-4,-133],[2,-143],[8,-132]], '#d9dfc9');
    // Sword path follows anticipation, fast contact and recovery.
    let angle = .52, handX = 10, handY = -68;
    if (attack) {
      const a = attack, t = a.t;
      if (a.kind === 'heavy') {
        if (t < .28) { angle = lerp(-.5, -2.25, clamp(t / .24, 0, 1)); handY = -74; }
        else if (t < .41) { angle = lerp(-2.25, 1.25, (t - .28) / .13); handY = -78; handX = 18; }
        else angle = lerp(1.25, .52, clamp((t - .41) / .38, 0, 1));
      } else {
        const reverse = a.index === 2;
        if (t < a.contact - .045) angle = reverse ? 1.6 : -1.85;
        else if (t < a.contact + .065) angle = lerp(reverse ? 1.6 : -1.85, reverse ? -1.3 : 1.3, clamp((t - a.contact + .045) / .11, 0, 1));
        else angle = lerp(reverse ? -1.3 : 1.3, .52, clamp((t - a.contact - .065) / .15, 0, 1));
        handX = 17;
      }
    }
    line([[9,-81],[handX+6,handY]], '#b4c5ad', 10);
    ctx.save(); ctx.translate(handX, handY); ctx.rotate(angle);
    rect(0,-3,26,6,'#594f3b'); rect(21,-11,6,22,'#c8ac70');
    poly([[27,-6],[99,-5],[118,0],[99,6],[27,6]], '#eef2d9');
    poly([[28,1],[111,0],[99,6],[27,6]], '#a9bfa8');
    line([[31,-4],[99,-3]], '#ffffed', 1);
    ctx.restore();
    ellipse(handX+4,handY,6,6,'#e5e8cc');
    ctx.restore();
    if (!ghost && attack && effects.particles) drawSlash();
  }
  function drawSlash() {
    const a = attack, t = a.t - a.contact, heavy = a.kind === 'heavy';
    if (t < -.045 || t > .18) return;
    const alpha = (1 - clamp((t + .01) / .19, 0, 1)) * .9;
    ctx.save(); ctx.translate(player.x, FLOOR - 75); ctx.scale(player.facing, 1); ctx.globalAlpha = alpha;
    const r = heavy ? 180 : a.index === 3 ? 156 : 140;
    ctx.rotate(a.index === 2 ? -.3 : .13);
    ctx.beginPath(); ctx.ellipse(42, -4, r, heavy ? 96 : 68, 0, -1.3, 1.4); ctx.ellipse(42,-4,r-29,heavy?72:46,0,1.4,-1.3,true); ctx.closePath();
    const g = ctx.createLinearGradient(0,-90,190,90); g.addColorStop(0,'#f3f6d500'); g.addColorStop(.6,heavy?'#fff3bdcc':'#dceee2bb'); g.addColorStop(1,'#ffffec'); ctx.fillStyle=g;ctx.fill();
    ctx.beginPath(); ctx.ellipse(42,-4,r,heavy?96:68,0,-1.1,1.25); ctx.strokeStyle='#fffbe1';ctx.lineWidth=heavy?4:2;ctx.stroke();
    ctx.restore();
  }
  function drawEnemy() {
    const e = enemy;
    if (e.dead && e.respawn < .85) return;
    const dir = challenge ? e.facing : (player.x < e.x ? -1 : 1);
    ellipse(e.x, FLOOR + 4, 38, 7, '#18372a45');
    ctx.save(); ctx.translate(e.x, FLOOR);
    if (e.dead) { ctx.globalAlpha = Math.max(0, (e.respawn - .85) / .3); ctx.translate(0, (1.15-e.respawn)*60); ctx.rotate((1.15-e.respawn)*1.5); }
    const recoil = effects.reaction ? e.recoil : 0;
    ctx.rotate(recoil * -.16 * dir);
    const walking = challenge && e.state === 'idle' && Math.abs(e.x - player.x) > 165 && e.stun <= 0;
    const step = walking ? Math.sin(e.walk) * 10 : 0;
    const light = effects.reaction && e.flash > 0;
    const armored = e.armored && e.armor > 0;
    let main = light ? '#f5efd0' : armored ? '#8c9483' : '#a39b69';
    let shade = light ? '#e9e9ce' : armored ? '#626f65' : '#777d51';
    let trim = light ? '#fff9df' : armored ? '#c0c8b2' : '#c2b381';
    poly([[-26,-44],[-7,-43],[-12+step,-9],[-31+step,-9]],shade);
    poly([[8,-43],[25,-43],[32-step,-9],[12-step,-9]],main);
    poly([[-32+step,-14],[-11+step,-14],[-8+step,-2],[-39+step,-2]],'#3e5140');
    poly([[11-step,-14],[33-step,-14],[40-step,-2],[10-step,-2]],'#3e5140');
    const wind = e.state === 'windup' ? Math.sin(clamp(e.stateTime / .72, 0, 1) * 1.4) : 0;
    const striking = e.state === 'strike' && e.stateTime < .2;
    ctx.translate(wind * -dir * 8, wind * 4);
    poly([[-32,-105],[-18,-117],[21,-115],[34,-100],[26,-50],[13,-40],[-22,-45],[-34,-67]],main,'#526146',1.5);
    poly([[-32,-103],[-18,-109],[-13,-55],[-23,-47],[-34,-67]],shade);
    poly([[-21,-111],[20,-110],[24,-93],[-24,-94]],trim);
    poly([[-19,-87],[18,-87],[20,-62],[-17,-61]],shade);
    ellipse(0,-77,10,10,light?'#fffbe5':'#485942');
    ellipse(0,-77,5,5,e.state==='windup'?'#f69c5d':armored?'#b8d2b5':'#e6be6b');
    line([[-11,-53],[13,-52]],'#d3c48d',3);
    // Upper arms, mechanical joints and forearms.
    for (const side of [-1,1]) {
      const attackArm = side === dir;
      ctx.save();ctx.translate(side*31,-98);
      if (attackArm) ctx.rotate(wind * -dir * .7 + (striking ? -dir * 1.2 : 0));
      poly([[-12,-5],[12,-5],[16,12],[11,25],[-13,22]],trim);
      rect(-9,20,19,22,shade);ellipse(0,23,6,6,'#4d5f49');
      poly([[-13,34],[14,34],[17,60],[7,68],[-14,63]],main,'#566548',1);
      rect(-10,48,23,5,trim);
      ctx.restore();
    }
    // Head floats slightly above the collar.
    const bob = Math.sin(time * 2 + .8) * 1.4;
    ctx.translate(0,bob);
    poly([[-21,-144],[-7,-153],[15,-149],[24,-133],[16,-115],[-17,-117],[-25,-130]],main,'#566548',1.5);
    poly([[-21,-144],[-7,-144],[-10,-121],[-18,-118],[-25,-130]],shade);
    poly([[-12,-137],[17,-137],[19,-128],[-13,-127]],'#354c3c');
    rect(dir<0?-12:1,-134,10,3,e.state==='windup'?'#ffb578':'#e4c887');
    line([[-8,-121],[10,-122]],trim,2);
    if (armored) {
      poly([[-33,-113],[-22,-122],[-13,-109],[-17,-90],[-35,-91]],'#aeb6a0');
      poly([[19,-116],[34,-111],[39,-93],[22,-91],[15,-105]],'#b3bba5');
      for(let i=0;i<e.armor;i++)rect(-10+i*8,-98,4,4,'#dbe2ca');
    }
    ctx.restore();
    if (e.state === 'windup') {
      const progress = e.stateTime/.72;
      ctx.save();ctx.globalAlpha=.25+progress*.35;
      ellipse(e.x+e.facing*100,FLOOR+2,140,12,'#d7673c');
      line([[e.x,FLOOR+1],[e.x+e.facing*210,FLOOR+1]],'#ffe0ab',2);
      ctx.restore();
      ctx.fillStyle='#b54d2e';ctx.font='bold 24px monospace';ctx.textAlign='center';ctx.fillText('!',e.x,FLOOR-181);
    }
    if (e.state === 'strike' && e.stateTime < .18) {
      ctx.save();ctx.translate(e.x,FLOOR-65);ctx.scale(e.facing,1);ctx.globalAlpha=1-e.stateTime/.18;
      poly([[20,-38],[180,-18],[210,4],[170,19],[18,18],[94,-3]],'#e8b17e88');ctx.restore();
    }
  }
  function drawEffects() {
    for (const p of particles) {
      ctx.save(); ctx.globalAlpha=clamp(p.life/p.max,0,1);
      if(p.kind==='ring') { const r=p.radius*(1-p.life/p.max);ctx.beginPath();ctx.ellipse(p.x,p.y,r,r*.72,0,0,Math.PI*2);ctx.strokeStyle=p.color;ctx.lineWidth=2*p.life/p.max;ctx.stroke(); }
      else {ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(p.vy,p.vx));rect(-p.size*2,0,p.size*4,p.size*.65,p.color);}
      ctx.restore();
    }
    for(const f of floats) {ctx.save();ctx.globalAlpha=Math.min(1,f.life*4);ctx.font=`${f.heavy?'bold 29':'bold 23'}px ui-monospace,monospace`;ctx.textAlign='center';ctx.shadowColor='#234632';ctx.shadowBlur=5;ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y);ctx.restore();}
  }
  function render() {
    const dpr = Math.min(devicePixelRatio || 1, 2), box = canvas.getBoundingClientRect();
    const width = Math.round(box.width*dpr), height = Math.round(box.height*dpr);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    // Crop and follow on narrow screens instead of squeezing characters horizontally.
    viewWidth = Math.min(W, box.width / box.height * H);
    const center = player.x + clamp(enemy.x - player.x, -250, 250) * .32;
    cameraX = clamp(center - viewWidth / 2, 0, W - viewWidth);
    ctx.setTransform(width/viewWidth,0,0,height/H,-cameraX*width/viewWidth,0);
    ctx.clearRect(cameraX,0,viewWidth,H);
    ctx.save();
    if(effects.shake&&shake>0)ctx.translate(Math.sin(time*171)*shake,Math.cos(time*139)*shake*.6);
    background();
    for(const g of ghosts){ctx.save();ctx.globalAlpha=g.life/.16*.19;drawPlayer(g.x,g.facing,true);ctx.restore();}
    if(player.x<enemy.x){drawPlayer();drawEnemy();}else{drawEnemy();drawPlayer();}
    drawEffects();ctx.restore();
  }
  function frame(timestamp) {
    const dt = Math.min((timestamp-lastTime)/1000 || .016,.035);lastTime=timestamp;
    update(dt);render();requestAnimationFrame(frame);
  }

  fxNames.forEach(k => $('fx-'+k).addEventListener('change',e=>{effects[k]=e.target.checked;if(k==='audio'&&effects.audio)initAudio();updatePresets();}));
  $('preset-raw').addEventListener('click',()=>preset(false));$('preset-full').addEventListener('click',()=>preset(true));
  $('intensity').addEventListener('input',e=>{intensity=Number(e.target.value)/100;$('intensity-value').value=e.target.value+'%';});
  $('target-type').addEventListener('change',()=>{resetScene(challenge);canvas.focus({preventScroll:true});});
  $('reset-button').addEventListener('click',()=>resetScene(challenge));
  $('challenge-button').addEventListener('click',()=>{initAudio();if(challenge)endChallenge(true);else resetScene(true);});
  $('again-button').addEventListener('click',()=>{initAudio();resetScene(true);});
  $('practice-button').addEventListener('click',()=>resetScene(false));
  document.querySelectorAll('[data-action]').forEach(b=>{
    b.addEventListener('pointerdown',e=>{e.preventDefault();attackRequest(b.dataset.action);});
    b.addEventListener('click',e=>{if(e.detail===0)attackRequest(b.dataset.action);});
  });
  document.querySelectorAll('[data-hold]').forEach(b=>{
    b.addEventListener('pointerdown',e=>{e.preventDefault();initAudio();touchKeys.add(b.dataset.hold);b.classList.add('held');b.setPointerCapture(e.pointerId);});
    const release=()=>{touchKeys.delete(b.dataset.hold);b.classList.remove('held');};
    b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);
  });
  window.addEventListener('keydown',e=>{
    const tag=e.target.tagName;
    if(['INPUT','SELECT','TEXTAREA'].includes(tag)||e.ctrlKey||e.metaKey||e.altKey)return;
    const key=e.key.toLowerCase();
    if([' ','arrowleft','arrowright','arrowup','arrowdown','j','k','b','r','a','d'].includes(key))e.preventDefault();
    if(e.repeat)return;
    keys.add(key);
    if(key==='j')attackRequest('light');else if(key==='k')attackRequest('heavy');else if(key===' ')attackRequest('dash');
    else if(key==='b')preset(!fxNames.some(k=>effects[k]));else if(key==='r')resetScene(challenge);
  });
  window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  function clearInput(){keys.clear();touchKeys.clear();queued=null;document.querySelectorAll('.key-button').forEach(b=>b.classList.remove('held'));}
  window.addEventListener('blur',clearInput);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();lastTime=performance.now();});
  canvas.addEventListener('pointerdown',()=>{initAudio();canvas.focus({preventScroll:true});});
  resetScene();updatePresets();requestAnimationFrame(frame);
})();

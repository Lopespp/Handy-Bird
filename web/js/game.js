export const config = Object.freeze({
  // A area do jogo termina no chao (floor); os canos saem da barra da fase logo abaixo.
  width: 820, height: 610, ceiling: 88, floor: 610,
  birdX: 210, birdRadius: 17, pipeWidth: 76, capOverhang: 5, capHeight: 23,
  // Dificuldade sobe devagar com os canos ultrapassados e tem limites suaves.
  initialGap: 205, minGap: 150, gapPerPipe: 0.4,
  initialSpacing: 380, minSpacing: 300, spacingPerPipe: 0.8,
  initialSpeed: 205, maxSpeed: 370, speedPerPipe: 1.8,
  // Durante um chefe: canos mais espacados, vaos maiores e sem bloqueios.
  bossSpacingFactor: 1.5, bossGapBonus: 25,
  // Modo Mouse (teste): mais rapido e com recarga maior, porque clicar e muito mais
  // facil que fechar a mao.
  mouseSpeedScale: 1.25, mouseShotCooldown: 1,
  laserSpeed: 900, laserLength: 30, laserRadius: 3,
  shotCooldown: 0.18, fistHold: 0.08, readySeconds: 1,
  bossEvery: 30, bossHealth: 8, bossWidth: 210, bossHeight: 240,
  bossSpeed: 150, throwInterval: 2, batSpeed: 200, batRadius: 11,
  lives: 3, invulnerable: 1.5,
  // No Vale Verde so aparece escudo, e mais espacado; depois, os tres tipos.
  earlyPowerEveryMin: 10, earlyPowerEveryMax: 14, powerEveryMin: 7, powerEveryMax: 10, powerRadius: 15,
  slowDuration: 5, slowFactor: 0.5, tripleDuration: 6, tripleSpread: 20,
  // Escudo dura ate 10 s (ou ate absorver uma batida). Power-ups aparecem as vezes no
  // vao do cano novo; nas outras, em qualquer altura no espaco livre entre dois canos.
  shieldDuration: 10, powerGapChance: 0.35, powerReach: 130,
  // Inimigos da fase (antes do chefe): voam em linha reta e caem com um laser.
  enemyRadius: 24, enemySpeedBonus: 70, firstEnemyDelay: 4, enemyEveryMin: 3.5, enemyEveryMax: 6,
  tralalero: Object.freeze({ width: 180, height: 130, health: 10, patrolSpeed: 100, rest: 2.6, warn: 1.1, dashSpeed: 620, returnSpeed: 320, bubbleInterval: 1.7, bubbleSpeed: 180, bubbleRadius: 13 }),
  // O Bombardino desce e sobe devagar (y de 150 a 320) para dar para acerta-lo sem ficar no teto.
  bombardino: Object.freeze({ width: 210, height: 84, health: 10, y: 150, swing: 170, swingSpeed: 0.9, minX: 400, maxX: 700, patrolSpeed: 110, dropInterval: 1.9, rageInterval: 1.4, bombSpeed: 230, gravity: 140, bombRadius: 12 }),
  cameraTop: 0.15, cameraBottom: 0.85, responsiveness: 4,
});

// Campanha: cada mapa termina no seu chefe; vencer os tres encerra o jogo.
export const stages = Object.freeze([
  Object.freeze({ key: "valley", boss: "tripleT", bossName: "TRIPLE T", enemy: "fadat" }),
  Object.freeze({ key: "beach", boss: "tralalero", bossName: "TRALALERO TRALALA", enemy: "tralaleirinho" }),
  Object.freeze({ key: "storm", boss: "bombardino", bossName: "BOMBARDINO CROCODILO", enemy: "bombo" }),
]);

// Power-ups: escudo (10 s ou uma batida), camera lenta (mundo a 50% por 5 s) e
// laser triplo (tres tiros por disparo por 6 s).
export const powerKinds = Object.freeze(["shield", "slow", "triple"]);

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const rectangle = (x, y, width, height) => new Phaser.Geom.Rectangle(x, y, width, height);
const intersects = (first, second) => Phaser.Geom.Intersects.RectangleToRectangle(first, second);

export function pipeRectangles(pipe) {
  const top = Math.round(pipe.gapY - pipe.gap / 2);
  const bottom = Math.round(pipe.gapY + pipe.gap / 2);
  const left = Math.round(pipe.x);
  return [
    rectangle(left, config.ceiling, config.pipeWidth, top - config.ceiling),
    rectangle(left - config.capOverhang, top - config.capHeight, config.pipeWidth + 2 * config.capOverhang, config.capHeight),
    rectangle(left, bottom, config.pipeWidth, config.floor - bottom),
    rectangle(left - config.capOverhang, bottom, config.pipeWidth + 2 * config.capOverhang, config.capHeight),
  ];
}

export function barrierRectangle(pipe) {
  return pipe.red && !pipe.destroyed
    ? rectangle(Math.round(pipe.x), Math.round(pipe.gapY - pipe.gap / 2), config.pipeWidth, Math.round(pipe.gap))
    : null;
}

export function bossSize(kind) {
  if (kind === "tralalero") return config.tralalero;
  if (kind === "bombardino") return config.bombardino;
  return { width: config.bossWidth, height: config.bossHeight, health: config.bossHealth };
}

export function bossRectangle(boss) {
  const { width, height } = bossSize(boss.kind);
  return rectangle(boss.x - width / 2, boss.y - height / 2, width, height);
}

// One Euro Filter (Casiez et al., 2012): suaviza bastante com a mao parada e
// quase nao atrasa em movimentos rapidos. `smoothing` e a constante de tempo em
// repouso, em segundos; zero desativa o filtro. Com responsiveness zero, vira a
// suavizacao exponencial simples.
export class OneEuroFilter {
  constructor({ smoothing = 0.08, responsiveness = config.responsiveness, derivativeCutoff = 1 } = {}) {
    this.minCutoff = smoothing > 0 ? 1 / (2 * Math.PI * smoothing) : Infinity;
    this.responsiveness = responsiveness;
    this.derivativeCutoff = derivativeCutoff;
    this.reset();
  }

  reset() { this.value = null; this.velocity = 0; }

  static alpha(cutoff, dt) { return 1 - Math.exp(-2 * Math.PI * cutoff * dt); }

  update(value, dt) {
    if (this.value === null || this.minCutoff === Infinity) { this.value = value; return value; }
    if (!(dt > 0)) return this.value;
    const velocity = (value - this.value) / dt;
    this.velocity += OneEuroFilter.alpha(this.derivativeCutoff, dt) * (velocity - this.velocity);
    const cutoff = this.minCutoff + this.responsiveness * Math.abs(this.velocity);
    this.value += OneEuroFilter.alpha(cutoff, dt) * (value - this.value);
    return this.value;
  }
}

const palmIndices = [0, 5, 9, 13, 17];
export function palmCenter(points) {
  if (points.length !== 21) return null;
  return {
    x: palmIndices.reduce((total, index) => total + points[index].x, 0) / palmIndices.length,
    y: palmIndices.reduce((total, index) => total + points[index].y, 0) / palmIndices.length,
  };
}

// Com uma mao rastreada, o MediaPipe segue a mesma mao entre quadros. O risco e
// perder essa mao e reencontrar a outra: uma mao de lateralidade diferente,
// longe da ultima posicao e pouco depois da perda e ignorada ate a trava expirar.
export class HandLock {
  constructor({ window = 1, maxJump = 0.3 } = {}) {
    this.window = window;
    this.maxJump = maxJump;
    this.reset();
  }

  reset() { this.center = null; this.label = null; this.seenAt = -Infinity; }

  accept(points, label, now) {
    const center = palmCenter(points);
    if (!center) return false;
    const locked = this.center !== null && now - this.seenAt < this.window;
    if (locked && label && this.label && label !== this.label
      && Math.hypot(center.x - this.center.x, center.y - this.center.y) > this.maxJump) return false;
    if (!locked || !this.label) this.label = label ?? null;
    this.center = center;
    this.seenAt = now;
    return true;
  }
}

// Registra a faixa vertical percorrida pela mao. A faixa final fica 10% para
// dentro dos extremos, para nao exigir esticar o braco ate o limite.
export class Calibration {
  constructor({ duration = 4, minimumSpan = 0.2 } = {}) {
    this.duration = duration;
    this.minimumSpan = minimumSpan;
    this.elapsed = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }

  get progress() { return clamp(this.elapsed / this.duration, 0, 1); }
  get done() { return this.elapsed >= this.duration; }

  add(handY, dt) {
    if (!Number.isFinite(handY)) return;
    this.elapsed += dt;
    this.min = Math.min(this.min, handY);
    this.max = Math.max(this.max, handY);
  }

  result() {
    const span = this.max - this.min;
    if (!(span >= this.minimumSpan)) return null;
    return { top: this.min + span * 0.1, bottom: this.max - span * 0.1 };
  }
}

export function validRange(range) {
  return !!range && Number.isFinite(range.top) && Number.isFinite(range.bottom)
    && range.top >= 0 && range.bottom <= 1 && range.bottom - range.top >= 0.1;
}

// Gesto de paz (indicador e medio esticados, anelar e minimo dobrados): pausa o voo.
export function isPeaceSign(points, aspectRatio = 1) {
  if (points.length !== 21) return false;
  const distance = (point) => Math.hypot((point.x - points[0].x) * aspectRatio, point.y - points[0].y);
  const extended = (joint, tip) => distance(points[tip]) > distance(points[joint]) * 1.15;
  const curled = (joint, tip) => distance(points[tip]) < distance(points[joint]) * 0.95;
  return extended(6, 8) && extended(10, 12) && curled(14, 16) && curled(18, 20);
}

export function isFistClosed(points, aspectRatio = 1, wasClosed = false) {
  if (points.length !== 21) return false;
  const distanceSquared = (point) => ((point.x - points[0].x) * aspectRatio) ** 2 + (point.y - points[0].y) ** 2;
  const threshold = wasClosed ? 1.05 : 0.9;
  return [[6, 8], [10, 12], [14, 16], [18, 20]].filter(([joint, tip]) =>
    distanceSquared(points[joint]) > 1e-8 && distanceSquared(points[tip]) < distanceSquared(points[joint]) * threshold ** 2,
  ).length >= 3;
}

export class Game {
  constructor({ random = Math.random, best = 0, smoothing = 0.08, responsiveness = config.responsiveness, mouse = false } = {}) {
    this.random = random;
    this.best = best;
    this.mouse = mouse;
    this.filter = new OneEuroFilter({ smoothing, responsiveness });
    this.range = { top: config.cameraTop, bottom: config.cameraBottom };
    this.restart();
  }

  setRange(range) {
    this.range = validRange(range) ? { top: range.top, bottom: range.bottom } : { top: config.cameraTop, bottom: config.cameraBottom };
    this.filter.reset();
  }

  restart() {
    this.state = "ready";
    this.score = 0;
    this.paused = false;
    this.tracked = false;
    this.readyElapsed = 0;
    this.elapsed = 0;
    this.normalizedY = null;
    this.filter?.reset();
    this.birdY = (config.ceiling + config.floor) / 2;
    this.shotCooldown = 0;
    this.fistElapsed = 0;
    this.fistLatched = false;
    this.lasers = [];
    this.impacts = [];
    this.projectiles = [];
    this.boss = null;
    this.stage = 0;
    this.nextBossAt = config.bossEvery;
    this.lives = config.lives;
    this.invulnerable = 0;
    this.shieldTimer = 0;
    this.slowTimer = 0;
    this.tripleTimer = 0;
    this.collected = 0;
    this.powers = [];
    this.enemies = [];
    this.enemyTimer = config.firstEnemyDelay;
    this.defeated = 0;
    this.pipesCreated = 0;
    this.nextPowerAt = Infinity;
    this.nextRedAt = this.redInterval();
    this.pipes = [this.newPipe(config.width + 100)];
    this.nextPowerAt = this.powerInterval();
  }

  redInterval() { return 3 + Math.floor(this.random() * 3); }
  powerInterval() {
    const [low, high] = this.stage === 0 ? [config.earlyPowerEveryMin, config.earlyPowerEveryMax] : [config.powerEveryMin, config.powerEveryMax];
    return low + Math.floor(this.random() * (high - low + 1));
  }
  get speed() {
    const speed = Math.min(config.maxSpeed, config.initialSpeed + this.score * config.speedPerPipe);
    return Math.round(speed * (this.mouse ? config.mouseSpeedScale : 1));
  }
  get spacing() {
    const spacing = Math.max(config.minSpacing, Math.round(config.initialSpacing - this.score * config.spacingPerPipe));
    return this.boss ? Math.round(spacing * config.bossSpacingFactor) : spacing;
  }

  newPipe(x) {
    this.pipesCreated += 1;
    // Bloqueios ficam suspensos durante o chefe e voltam no primeiro cano depois dele.
    const red = !this.boss && this.pipesCreated >= this.nextRedAt;
    if (red) this.nextRedAt = this.pipesCreated + this.redInterval();
    const gap = Math.max(config.minGap, Math.round(config.initialGap - this.score * config.gapPerPipe)) + (this.boss ? config.bossGapBonus : 0);
    const margin = gap / 2 + 38;
    const gapY = config.ceiling + margin + this.random() * (config.floor - config.ceiling - 2 * margin);
    if (!red && this.pipesCreated >= this.nextPowerAt) {
      const kind = this.stage === 0 ? "shield" : powerKinds[Math.floor(this.random() * powerKinds.length)];
      this.nextPowerAt = this.pipesCreated + this.powerInterval();
      this.placePower(kind, x, gapY, gap);
    }
    return { x, gapY, gap, red, destroyed: false, scored: false };
  }

  // Power-up em lugar aleatorio, mas sempre alcancavel: as vezes dentro do vao do
  // cano novo; nas outras, em qualquer altura no espaco livre entre ele e o anterior.
  placePower(kind, pipeX, gapY, gap) {
    if (this.random() < config.powerGapChance) {
      const room = Math.max(0, gap / 2 - config.powerRadius - 8);
      this.powers.push({ kind, x: pipeX + config.pipeWidth / 2, y: gapY + (this.random() * 2 - 1) * room });
      return;
    }
    const previous = this.pipes?.at(-1);
    const middle = previous ? (previous.x + pipeX) / 2 : pipeX - this.spacing / 2;
    // Altura sorteada perto dos dois vaos vizinhos, para dar tempo de buscar e voltar.
    const margin = config.powerRadius + 30;
    const nearby = [previous?.gapY ?? gapY, gapY];
    const low = Math.max(config.ceiling + margin, Math.min(...nearby) - config.powerReach);
    const high = Math.min(config.floor - margin, Math.max(...nearby) + config.powerReach);
    this.powers.push({ kind, x: middle + config.pipeWidth / 2, y: low + this.random() * (high - low) });
  }

  // Escudo: dura ate 10 s ou ate absorver uma batida.
  get shield() { return this.shieldTimer > 0; }
  set shield(active) { this.shieldTimer = active ? config.shieldDuration : 0; }

  // Uma batida gasta o escudo ou uma vida e da invencibilidade breve.
  hurt() {
    if (this.invulnerable > 0 || this.finished) return false;
    if (this.shield) this.shield = false;
    else {
      this.lives -= 1;
      if (this.lives <= 0) { this.state = "over"; return true; }
    }
    this.invulnerable = config.invulnerable;
    return true;
  }

  collect(power) {
    this.collected += 1;
    if (power.kind === "shield") this.shield = true;
    else if (power.kind === "slow") this.slowTimer = config.slowDuration;
    else this.tripleTimer = config.tripleDuration;
  }

  get finished() { return this.state === "over" || this.state === "won"; }
  get currentStage() { return stages[Math.min(this.stage, stages.length - 1)]; }

  togglePause() {
    if (!this.finished) this.paused = !this.paused;
  }

  update(handY, dt, fistClosed = false) {
    dt = clamp(dt, 0, 0.05);
    this.tracked = Number.isFinite(handY);
    if (this.finished || this.paused) {
      this.fistElapsed = 0;
      this.fistLatched = fistClosed;
      return;
    }
    if (!this.tracked) {
      this.readyElapsed = 0;
      this.fistElapsed = 0;
      return;
    }
    const target = clamp((handY - this.range.top) / (this.range.bottom - this.range.top), 0, 1);
    this.normalizedY = this.filter.update(target, dt);
    this.birdY = config.ceiling + config.birdRadius + 4 + this.normalizedY * (config.floor - config.ceiling - 2 * (config.birdRadius + 4));
    if (this.state === "ready") {
      this.fistLatched = fistClosed;
      this.fistElapsed = 0;
      this.readyElapsed += dt;
      if (this.readyElapsed >= config.readySeconds) this.state = "playing";
      return;
    }
    this.elapsed += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.tripleTimer = Math.max(0, this.tripleTimer - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    // Camera lenta desacelera canos, chefe e projeteis; lasers e timers seguem normais.
    const world = this.slowTimer > 0 ? dt * config.slowFactor : dt;
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.updateFiring(fistClosed, dt);
    this.impacts.forEach((impact) => { impact.remaining -= dt; });
    this.impacts = this.impacts.filter((impact) => impact.remaining > 0);
    this.pipes.forEach((pipe) => { pipe.x -= this.speed * world; });
    this.powers.forEach((power) => { power.x -= this.speed * world; });
    this.spawnBoss();
    this.updateBoss(world);
    this.updateEnemies(world);
    this.updateLasers(dt);
    this.updateProjectiles(world);
    if (this.boss && Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(config.birdX, this.birdY, config.birdRadius), bossRectangle(this.boss))) this.hurt();
    if (this.finished) return;
    this.powers = this.powers.filter((power) => {
      if (Math.hypot(power.x - config.birdX, power.y - this.birdY) > config.birdRadius + config.powerRadius) return power.x > -config.powerRadius;
      this.collect(power);
      return false;
    });
    for (const pipe of this.pipes) {
      if (this.collides(pipe)) { this.hurt(); if (this.finished) return; }
      if (!pipe.scored && pipe.x + config.pipeWidth < config.birdX) {
        pipe.scored = true;
        this.score += 1;
        this.best = Math.max(this.best, this.score);
      }
      this.spawnBoss();
    }
    if (this.pipes.at(-1).x <= config.width - this.spacing) this.pipes.push(this.newPipe(config.width));
    this.pipes = this.pipes.filter((pipe) => pipe.x + config.pipeWidth + 6 >= 0);
  }

  fire() {
    const offsets = this.tripleTimer > 0 ? [-config.tripleSpread, 0, config.tripleSpread] : [0];
    for (const offset of offsets) this.lasers.push({ x: config.birdX + config.birdRadius + 4, y: clamp(this.birdY + offset, config.ceiling + 4, config.floor - 4) });
    this.shotCooldown = this.mouse ? config.mouseShotCooldown : config.shotCooldown;
  }

  updateFiring(closed, dt) {
    this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    if (!closed) { this.fistElapsed = 0; this.fistLatched = false; return; }
    this.fistElapsed += dt;
    if (!this.fistLatched && this.fistElapsed >= config.fistHold) {
      this.fistLatched = true;
      if (this.shotCooldown <= 0) this.fire();
    }
  }

  updateLasers(dt) {
    const active = [];
    for (const laser of this.lasers) {
      const previousX = laser.x;
      laser.x += config.laserSpeed * dt;
      const sweep = rectangle(previousX, laser.y - config.laserRadius, laser.x + config.laserLength - previousX, config.laserRadius * 2 + 1);
      let hit = null;
      let hitBarrier = false;
      for (const pipe of [...this.pipes].sort((first, second) => first.x - second.x)) {
        const barrier = barrierRectangle(pipe);
        if (barrier && intersects(sweep, barrier)) { hit = pipe; hitBarrier = true; break; }
        if (!this.boss && pipeRectangles(pipe).some((body) => intersects(sweep, body))) { hit = pipe; break; }
      }
      // Inimigo mais proximo atingido antes de um cano ou do chefe cai com um laser.
      let enemy = null;
      for (const candidate of this.enemies) {
        if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(candidate.x, candidate.y, config.enemyRadius), sweep) && (!enemy || candidate.x < enemy.x)) enemy = candidate;
      }
      const bossLeft = this.boss && intersects(sweep, bossRectangle(this.boss)) ? bossRectangle(this.boss).left : Infinity;
      if (enemy && (!hit || enemy.x - config.enemyRadius < hit.x) && enemy.x - config.enemyRadius < bossLeft) {
        this.enemies.splice(this.enemies.indexOf(enemy), 1);
        this.defeated += 1;
        this.impacts.push({ x: enemy.x, y: enemy.y, remaining: 0.24 });
        continue;
      }
      if (this.boss && intersects(sweep, bossRectangle(this.boss)) && (!hit || bossRectangle(this.boss).left < hit.x)) {
        this.boss.health -= 1;
        this.boss.hurt = 0.12;
        this.impacts.push({ x: bossRectangle(this.boss).left, y: laser.y, remaining: 0.24 });
        if (this.boss.health <= 0) this.defeatBoss();
      } else if (hit) {
        if (hitBarrier) hit.destroyed = true;
        this.impacts.push({ x: Math.max(previousX, hit.x), y: laser.y, remaining: 0.24 });
      } else if (laser.x < config.width) active.push(laser);
    }
    this.lasers = active;
  }

  spawnBoss() {
    if (this.boss || this.stage >= stages.length || this.score < this.nextBossAt) return;
    const kind = stages[this.stage].boss;
    const { width, health } = bossSize(kind);
    const middle = (config.ceiling + config.floor) / 2;
    const y = kind === "bombardino" ? config.bombardino.y : middle;
    const x = kind === "bombardino" ? config.bombardino.maxX : config.width - width / 2 - 24;
    this.boss = {
      kind, x, y, homeX: x, health, maxHealth: health, direction: 1, hurt: 0,
      timer: kind === "tralalero" ? config.tralalero.rest : kind === "bombardino" ? config.bombardino.dropInterval : config.throwInterval,
      phase: "idle", laneY: y, shotTimer: kind === "tralalero" ? config.tralalero.bubbleInterval : 0,
    };
    this.nextBossAt = Infinity;
  }

  // O proximo mapa comeca quando o chefe cai; o proximo chefe chega 30 canos depois.
  defeatBoss() {
    this.boss = null;
    this.projectiles = [];
    this.stage += 1;
    if (this.stage >= stages.length) { this.state = "won"; this.best = Math.max(this.best, this.score); }
    else this.nextBossAt = this.score + config.bossEvery;
  }

  // Inimigos da fase: enquanto o chefe nao chega, surgem na direita e cruzam a tela
  // em linha reta, um pouco mais rapidos que os canos. Encostar custa uma vida.
  updateEnemies(dt) {
    if (!this.boss && this.stage < stages.length) {
      this.enemyTimer -= dt;
      if (this.enemyTimer <= 0) {
        const margin = config.enemyRadius + 30;
        this.enemies.push({ kind: stages[this.stage].enemy, x: config.width + config.enemyRadius + 20, y: config.ceiling + margin + this.random() * (config.floor - config.ceiling - 2 * margin) });
        this.enemyTimer = config.enemyEveryMin + this.random() * (config.enemyEveryMax - config.enemyEveryMin);
      }
    }
    const speed = this.speed + config.enemySpeedBonus;
    this.enemies = this.enemies.filter((enemy) => {
      enemy.x -= speed * dt;
      if (Math.hypot(enemy.x - config.birdX, enemy.y - this.birdY) <= config.birdRadius + config.enemyRadius && this.hurt()) return false;
      return enemy.x > -config.enemyRadius - 20;
    });
  }

  launch(kind, x, y, velocityX, velocityY, radius, gravity = 0) {
    this.projectiles.push({ kind, x, y, velocityX, velocityY, radius, gravity });
  }

  updateBoss(dt) {
    const boss = this.boss;
    if (!boss) return;
    boss.hurt = Math.max(0, boss.hurt - dt);
    if (boss.kind === "tralalero") this.updateTralalero(boss, dt);
    else if (boss.kind === "bombardino") this.updateBombardino(boss, dt);
    else this.updateTripleT(boss, dt);
  }

  patrolVertically(boss, height, speed, dt) {
    const top = config.ceiling + height / 2 + 18;
    const bottom = config.floor - height / 2 - 18;
    boss.y += boss.direction * speed * dt;
    if (boss.y >= bottom) { boss.y = bottom; boss.direction = -1; }
    if (boss.y <= top) { boss.y = top; boss.direction = 1; }
  }

  // Triple T: sobe e desce arremessando tacos na direcao do jogador.
  updateTripleT(boss, dt) {
    this.patrolVertically(boss, config.bossHeight, config.bossSpeed, dt);
    boss.timer -= dt;
    if (boss.timer <= 0) {
      const x = boss.x - config.bossWidth / 2;
      const horizontal = config.birdX - x;
      const vertical = this.birdY - boss.y;
      const length = Math.hypot(horizontal, vertical);
      this.launch("bat", x, boss.y, horizontal / length * config.batSpeed, vertical / length * config.batSpeed, config.batRadius);
      boss.timer += config.throwInterval;
    }
  }

  // Tralalero Tralala: marca a altura do jogador, avisa e atravessa a tela.
  updateTralalero(boss, dt) {
    const shark = config.tralalero;
    if (boss.phase === "idle") {
      this.patrolVertically(boss, shark.height, shark.patrolSpeed, dt);
      boss.shotTimer -= dt;
      if (boss.shotTimer <= 0) {
        this.launch("bubble", boss.x - shark.width / 2, boss.y, -shark.bubbleSpeed, 0, shark.bubbleRadius);
        boss.shotTimer += shark.bubbleInterval;
      }
      boss.timer -= dt;
      if (boss.timer <= 0) {
        boss.phase = "warn";
        boss.timer = shark.warn;
        boss.laneY = clamp(this.birdY, config.ceiling + shark.height / 2, config.floor - shark.height / 2);
      }
    } else if (boss.phase === "warn") {
      boss.y += clamp(boss.laneY - boss.y, -shark.returnSpeed * dt, shark.returnSpeed * dt);
      boss.timer -= dt;
      if (boss.timer <= 0) { boss.phase = "dash"; boss.y = boss.laneY; }
    } else if (boss.phase === "dash") {
      boss.x -= shark.dashSpeed * dt;
      if (boss.x + shark.width / 2 < 0) { boss.phase = "return"; boss.x = config.width + shark.width / 2; }
    } else {
      boss.x = Math.max(boss.homeX, boss.x - shark.returnSpeed * dt);
      if (boss.x === boss.homeX) { boss.phase = "idle"; boss.timer = shark.rest; }
    }
  }

  // Bombardino Crocodilo: patrulha a parte de cima soltando bombas, descendo e
  // subindo devagar; com metade da vida, solta duas bombas em leque.
  updateBombardino(boss, dt) {
    const plane = config.bombardino;
    boss.swingTime = (boss.swingTime ?? 0) + dt;
    boss.y = plane.y + plane.swing * (1 - Math.cos(boss.swingTime * plane.swingSpeed)) / 2;
    boss.x += -boss.direction * plane.patrolSpeed * dt;
    if (boss.x <= plane.minX) { boss.x = plane.minX; boss.direction = -1; }
    if (boss.x >= plane.maxX) { boss.x = plane.maxX; boss.direction = 1; }
    boss.timer -= dt;
    if (boss.timer <= 0) {
      const enraged = boss.health * 2 <= boss.maxHealth;
      const speeds = enraged ? [0.8, 1.2] : [1];
      for (const factor of speeds) this.launch("bomb", boss.x, boss.y + plane.height / 2 - 10, -plane.bombSpeed * factor, 0, plane.bombRadius, plane.gravity);
      boss.timer += enraged ? plane.rageInterval : plane.dropInterval;
    }
  }

  updateProjectiles(dt) {
    this.projectiles = this.projectiles.filter((shot) => {
      const startX = shot.x;
      const startY = shot.y;
      shot.velocityY += shot.gravity * dt;
      const travelX = shot.velocityX * dt;
      const travelY = shot.velocityY * dt;
      shot.x += travelX;
      shot.y += travelY;
      const distance = travelX ** 2 + travelY ** 2;
      const fraction = distance ? clamp(((config.birdX - startX) * travelX + (this.birdY - startY) * travelY) / distance, 0, 1) : 0;
      if (Math.hypot(config.birdX - startX - travelX * fraction, this.birdY - startY - travelY * fraction) <= config.birdRadius + shot.radius && this.hurt()) return false;
      return shot.x > -40 && shot.x < config.width + 40 && shot.y > config.ceiling - 40 && shot.y < config.floor + 40;
    });
  }

  collides(pipe) {
    const shapes = pipeRectangles(pipe);
    const barrier = barrierRectangle(pipe);
    if (barrier) shapes.push(barrier);
    const bird = new Phaser.Geom.Circle(config.birdX, this.birdY, config.birdRadius);
    return shapes.some((shape) => Phaser.Geom.Intersects.CircleToRectangle(bird, shape));
  }
}
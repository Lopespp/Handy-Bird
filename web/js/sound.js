// Efeitos sintetizados com Web Audio: nenhum arquivo de audio para baixar.
const KEY = "handy-bird-muted";

function storedMuted() { try { return (localStorage.getItem(KEY) ?? localStorage.getItem("flappy-hand-muted")) === "1"; } catch { return false; } }

export class Sound {
  constructor() {
    this.muted = storedMuted();
    this.context = null;
    this.snapshot = null;
  }

  // Navegadores so liberam audio depois de um gesto do jogador.
  unlock() {
    if (this.muted) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") this.context.resume();
    } catch { this.context = null; }
  }

  setMuted(muted) {
    this.muted = muted;
    try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch {}
    if (!muted) this.unlock();
  }

  tone({ from, to = from, duration = 0.12, type = "square", volume = 0.08, delay = 0 }) {
    const context = this.context;
    if (this.muted || !context || context.state !== "running") return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  laser() { this.tone({ from: 1400, to: 420, duration: 0.1, type: "sawtooth", volume: 0.04 }); }
  point() { this.tone({ from: 880, duration: 0.06, volume: 0.05 }); this.tone({ from: 1320, duration: 0.08, volume: 0.05, delay: 0.06 }); }
  shatter() { this.tone({ from: 320, to: 90, duration: 0.18, type: "sawtooth", volume: 0.07 }); }
  hit() { this.tone({ from: 220, to: 110, duration: 0.09, volume: 0.07 }); }
  alarm() { [0, 0.18, 0.36].forEach((delay) => this.tone({ from: 520, to: 380, duration: 0.14, type: "triangle", volume: 0.09, delay })); }
  victory() { [523, 659, 784, 1047].forEach((from, index) => this.tone({ from, duration: 0.12, volume: 0.06, delay: index * 0.09 })); }
  fanfare() { [523, 659, 784, 659, 784, 1047].forEach((from, index) => this.tone({ from, duration: 0.16, type: "triangle", volume: 0.08, delay: 0.5 + index * 0.13 })); }
  pickup() { [660, 880, 1320].forEach((from, index) => this.tone({ from, duration: 0.07, type: "triangle", volume: 0.07, delay: index * 0.05 })); }
  pop() { this.tone({ from: 520, to: 980, duration: 0.12, type: "square", volume: 0.06 }); }
  ouch() { this.tone({ from: 300, to: 140, duration: 0.2, type: "square", volume: 0.08 }); }
  crash() { this.tone({ from: 440, to: 60, duration: 0.45, type: "triangle", volume: 0.12 }); }

  // Compara o estado do jogo entre quadros e toca o efeito de cada evento.
  // Nao altera as regras: apenas observa pontos, tiros, placas, inimigos, chefe e fim.
  observe(game) {
    const current = {
      score: game.score, cooldown: game.shotCooldown, state: game.state,
      broken: game.broken,
      bossHealth: game.boss?.health ?? null,
      lives: game.lives, invulnerable: game.invulnerable, collected: game.collected, defeated: game.defeated,
    };
    const previous = this.snapshot;
    this.snapshot = current;
    if (!previous || current.score < previous.score || (["over", "won"].includes(previous.state) && current.state !== previous.state)) return;
    if (current.cooldown > previous.cooldown) this.laser();
    if (current.broken > previous.broken) this.shatter();
    if (current.score > previous.score) this.point();
    if (previous.bossHealth === null && current.bossHealth !== null) this.alarm();
    else if (previous.bossHealth !== null && current.bossHealth === null) this.victory();
    else if (current.bossHealth < previous.bossHealth) this.hit();
    if (current.collected > previous.collected) this.pickup();
    if (current.defeated > previous.defeated) this.pop();
    // Batida: vida perdida ou escudo gasto (o escudo que expira em silencio nao conta).
    if (current.state !== "over" && current.invulnerable > previous.invulnerable) this.ouch();
    if (previous.state !== "over" && current.state === "over") this.crash();
    if (previous.state !== "won" && current.state === "won") this.fanfare();
  }
}

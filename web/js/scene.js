import { config, stages } from "./game.js";
import { t } from "./i18n.js";

const asset = (path) => `./assets/${path}`;

// Handy e o protagonista; os outros sao selecionaveis. Cada um tem a cor do seu
// laser: borda, meio e nucleo.
export const characters = {
  handy: { name: "Handy", asset: asset("characters/handy.png"), laser: [0xc77700, 0xffd23f, 0xfffbe6] },
  pombo: { name: "PoMMMbo", asset: asset("characters/mmm_pompo.png"), laser: [0x17834a, 0x5ff08f, 0xeafff1] },
  claraia: { name: "Claraia", asset: asset("characters/claraia.png"), laser: [0xc0307a, 0xff84c4, 0xfff0f8] },
  gavian: { name: "Gavian", asset: asset("characters/gavian.png"), laser: [0x5b2bb5, 0xb38bff, 0xf4eeff] },
};

// Cenario em pixel art (820 x 610, sem a faixa de terra) de cada mapa. Canos e
// bloqueios usam os sprites gerados por tools/pipes.py; pipes.json diz em que
// linha de cada ponta fica a borda, para alinha-la com o vao.
export const themes = {
  valley: { background: asset("stages/bg-valley.jpg") },
  beach: { background: asset("stages/bg-beach.jpg") },
  storm: { background: asset("stages/bg-storm.jpg") },
};
const pipeParts = ["body", "top", "bottom"];

const powerColors = { shield: 0x2f8fdc, slow: 0x8a5cd6, triple: 0xe0a72e };
// Herois maiores na tela (a colisao continua com o raio de config.birdRadius) e o
// anel do escudo em volta deles, na cor do laser de cada personagem.
const heroSize = { width: 84, height: 68 };
const shieldRadius = 46;
export const minionKinds = Object.freeze(stages.map((stage) => stage.minion));

export function createScene(state, afterUpdate, setPointer, loadFailure) {
  return class FlightScene extends Phaser.Scene {
    preload() {
      for (const [key, character] of Object.entries(characters)) this.load.image(key, character.asset);
      for (const [key, theme] of Object.entries(themes)) this.load.image(`bg-${key}`, theme.background);
      for (const key of Object.keys(themes)) {
        for (const part of pipeParts) this.load.image(`pipe-${key}-${part}`, asset(`stages/pipe-${key}-${part}.png`));
        this.load.image(`blocker-${key}`, asset(`stages/blocker-${key}.png`));
      }
      this.load.json("pipes", asset("stages/pipes.json"));
      this.load.image("valleyWarden", asset("bosses/valley_warden.png"));
      this.load.image("sharking", asset("bosses/sharking.png"));
      this.load.image("ironbeak", asset("bosses/ironbeak.png"));
      this.load.image("bomb", asset("bosses/bomb.png"));
      for (const kind of minionKinds) this.load.image(kind, asset(`minions/${kind}.png`));
      this.load.on("loaderror", () => loadFailure(t("error.images")));
    }

    create() {
      this.backdrops = Object.fromEntries(Object.keys(themes).map((key) => [key, this.add.image(0, 0, `bg-${key}`).setOrigin(0).setDepth(-10).setVisible(key === "valley")]));
      this.weather = this.add.graphics().setDepth(-9);
      this.pipeMeta = this.cache.json.get("pipes");
      this.pipeViews = [];
      this.buildPipeColumns();
      this.dynamic = this.add.graphics();
      this.hero = this.add.image(config.birdX, 350, state.character);
      // Sprites dos chefes no tamanho final; a area de acerto fica em config[chefe].
      this.bossImages = Object.fromEntries(stages.map(({ boss }) => [boss, this.add.image(0, 0, boss).setVisible(false)]));
      this.shotImages = [];
      this.minionImages = [];
      // Porrete do Valley Warden: cabeca grossa com espinhos, cabo fino e cipo enrolado.
      const club = this.make.graphics({ x: 0, y: 0, add: false });
      club.fillStyle(0x3b2412).fillTriangle(6, 3, 10, 0, 12, 4).fillTriangle(16, 3, 20, 0, 21, 4).fillTriangle(8, 17, 12, 20, 14, 17).fillTriangle(18, 17, 22, 20, 23, 17);
      club.fillRoundedRect(0, 2, 28, 16, 6).fillRect(25, 7, 21, 7);
      club.fillStyle(0x7a4a24).fillRoundedRect(2, 4, 24, 12, 5).fillRect(27, 9, 17, 3);
      club.lineStyle(2, 0xa8703c).lineBetween(5, 6, 20, 6);
      club.fillStyle(0x3b2412).fillCircle(9, 11, 1.5).fillCircle(18, 12, 1.5);
      club.lineStyle(2, 0x5f8f32).lineBetween(12, 4, 16, 16).lineBetween(19, 4, 23, 16);
      club.generateTexture("club", 46, 20); club.destroy();
      this.header = this.add.graphics().setDepth(5);
      this.hud = this.add.graphics().setDepth(6);
      const display = "Fredoka, Bahnschrift, 'Trebuchet MS', sans-serif";
      this.powerText = this.add.text(206, 58, "", { fontFamily: display, fontSize: "13px", color: "#2a9466" }).setDepth(6);
      this.characterName = this.add.text(26, 22, "", { fontFamily: display, fontSize: "32px", fontStyle: "bold", color: "#1d2140" }).setDepth(6);
      const small = { fontFamily: display, fontSize: "13px", color: "#5d6280" };
      this.pointsLabel = this.add.text(610, 16, "", small).setDepth(6);
      this.bestLabel = this.add.text(711, 16, "", small).setDepth(6);
      this.translate();
      const scoreStyle = { fontFamily: display, fontSize: "36px", fontStyle: "bold", color: "#1d2140" };
      this.score = this.add.text(606, 31, "00", scoreStyle).setDepth(6);
      this.best = this.add.text(708, 31, "00", scoreStyle).setDepth(6);
      this.bossTitle = this.add.text(350, 16, "", { ...small, color: "#de5a48" }).setVisible(false).setDepth(6);
      this.health = this.add.graphics().setDepth(6);
      this.input.on("pointermove", (pointer) => setPointer(pointer.y));
      this.input.on("pointerdown", (pointer) => { setPointer(pointer.y); state.pointerFist = true; });
      this.input.on("pointerup", () => { state.pointerFist = false; });
      this.input.on("gameout", () => { state.pointerFist = false; });
      state.scene = this;
      this.selectCharacter(state.character);
      this.showStage("valley");
      state.ready = true;
    }

    // Rotulos fixos do placar; o resto do texto do jogo e escrito a cada quadro.
    translate() {
      this.pointsLabel.setText(t("hud.points"));
      this.bestLabel.setText(t("hud.best"));
    }

    selectCharacter(character) {
      this.hero.setTexture(character);
      const source = this.hero.texture.getSourceImage();
      this.hero.setScale(Math.min(heroSize.width / source.width, heroSize.height / source.height));
      this.characterName.setText(characters[character].name);
    }

    showStage(key) {
      if (this.stageKey === key) return;
      this.stageKey = key;
      for (const [name, image] of Object.entries(this.backdrops)) image.setVisible(name === key);
      this.header.clear();
      this.header.fillStyle(0xf8fcfa).fillRect(0, 0, 820, 88);
    }

    update(time, delta) {
      const input = state.mode === "camera" ? state.camera?.read() : { handY: state.pointerY, closed: state.pointerFist || state.spaceFist };
      const tracked = state.active && !document.hidden && state.ready;
      const handY = tracked ? (input?.handY ?? null) : null;
      if (state.calibration) {
        // Durante a calibracao o voo fica congelado e so a faixa da mao e registrada.
        state.calibration.add(handY, delta / 1000);
        state.game.update(null, delta / 1000);
      } else state.game.update(handY, delta / 1000, input?.closed ?? false);
      this.drawGame();
      afterUpdate(time, input);
    }

    drawWeather(game) {
      const graphics = this.weather;
      graphics.clear();
      if (this.stageKey !== "storm") return;
      graphics.lineStyle(2, 0x8d97c4, 0.55);
      const offset = (game.elapsed * 520) % 60;
      for (let x = -40; x < 860; x += 34) for (let y = 88 - 60 + offset; y < 610; y += 60) graphics.lineBetween(x + (y - 88) * 0.25, y, x + (y - 88) * 0.25 + 5, y + 16);
      // Relampago curto a cada ~4 s.
      const flash = game.elapsed % 4.2;
      if (flash < 0.12) graphics.fillStyle(0xe6ecff, 0.35 - flash * 2.5).fillRect(0, 88, 820, 522);
    }

    drawBoss(game, graphics) {
      for (const image of Object.values(this.bossImages)) image.setVisible(false);
      const boss = game.boss;
      if (!boss) return;
      if (boss.kind === "sharking" && boss.phase === "warn" && Math.floor(game.elapsed * 10) % 2 === 0) {
        graphics.fillStyle(0xde5a48, 0.28).fillRect(0, boss.laneY - config.sharking.height / 2, 820, config.sharking.height);
        graphics.lineStyle(2, 0xde5a48, 0.9).strokeRect(0, boss.laneY - config.sharking.height / 2, 820, config.sharking.height);
      }
      const image = this.bossImages[boss.kind];
      image.setVisible(true).setPosition(boss.x, boss.y);
      if (boss.hurt > 0) image.setTint(0xffbb88); else image.clearTint();
    }

    // Corpo dos canos: uma coluna alta pronta por fase (o corpo repetido ate a
    // altura do jogo). Cada parte mostra so o trecho necessario com setCrop, sem
    // redesenhar texturas a cada quadro.
    buildPipeColumns() {
      for (const key of Object.keys(themes)) {
        const tile = this.textures.get(`pipe-${key}-body`).getSourceImage();
        const column = this.textures.createCanvas(`pipe-${key}-column`, config.pipeWidth, config.floor);
        const context = column.getContext();
        for (let y = 0; y < config.floor; y += tile.height) context.drawImage(tile, 0, y);
        column.refresh();
      }
    }

    makePipeView() {
      const column = () => this.add.image(0, 0, "pipe-valley-column").setOrigin(0).setDepth(-5);
      const view = {
        key: null, shown: true,
        topBody: column(), bottomBody: column(),
        top: this.add.image(0, 0, "pipe-valley-top").setOrigin(0.5, 0).setDepth(-5),
        bottom: this.add.image(0, 0, "pipe-valley-bottom").setOrigin(0.5, 0).setDepth(-5),
        // Anel da borda de cima, repetido embaixo do vao enquanto ha bloqueio.
        ring: this.add.image(0, 0, "pipe-valley-top").setOrigin(0.5, 0).setDepth(-5),
        blocker: this.add.image(0, 0, "blocker-valley").setDepth(-4),
      };
      view.parts = [view.topBody, view.bottomBody, view.top, view.bottom, view.ring, view.blocker];
      return view;
    }

    showColumn(image, left, top, bottom) {
      const visible = bottom > top;
      image.setVisible(visible);
      if (visible) image.setPosition(left, top).setCrop(0, 0, config.pipeWidth, bottom - top);
    }

    // Cano de cima: corpo do teto ate a ponta, com a borda terminando no vao.
    // Cano de baixo: ponta com a borda no vao e corpo ate a barra da fase.
    // Bloqueio: corpo continuo do vao ate a barra, o desenho do bloqueio no vao e um
    // anel igual ao de cima marcando o fim do vao.
    placePipe(view, pipe) {
      if (!pipe) {
        if (view.shown) { for (const part of view.parts) part.setVisible(false); view.shown = false; }
        return;
      }
      view.shown = true;
      const key = this.stageKey;
      if (view.key !== key) {
        view.key = key;
        for (const body of [view.topBody, view.bottomBody]) body.setTexture(`pipe-${key}-column`);
        view.top.setTexture(`pipe-${key}-top`);
        view.ring.setTexture(`pipe-${key}-top`);
        view.bottom.setTexture(`pipe-${key}-bottom`);
        view.blocker.setTexture(`blocker-${key}`);
      }
      const meta = this.pipeMeta[key];
      const left = Math.round(pipe.x);
      const center = left + config.pipeWidth / 2;
      const gapTop = Math.round(pipe.gapY - pipe.gap / 2);
      const gapBottom = Math.round(pipe.gapY + pipe.gap / 2);
      const topY = gapTop - meta.topLip;
      view.top.setVisible(true).setPosition(center, topY);
      this.showColumn(view.topBody, left, config.ceiling, topY);
      // Com o bloqueio intacto, o cano segue inteiro do vao ate a barra e um anel igual
      // ao de cima marca o fim do vao; a ponta aberta de baixo so aparece depois que o
      // bloqueio e destruido.
      const barrier = pipe.red && !pipe.destroyed;
      const bottomY = gapBottom - meta.bottomLip;
      view.bottom.setVisible(!barrier);
      if (!barrier) view.bottom.setPosition(center, bottomY);
      this.showColumn(view.bottomBody, left, barrier ? gapTop : bottomY + view.bottom.height, config.floor);
      view.ring.setVisible(barrier);
      if (barrier) {
        // A borda do anel ocupa a borda de colisao logo abaixo do vao.
        view.ring.setCrop(0, meta.ringTop, view.ring.width, view.ring.height - meta.ringTop)
          .setPosition(center, gapBottom + config.capHeight - meta.topLip);
      }
      view.blocker.setVisible(barrier);
      // O bloqueio encolhe para caber em vaos menores que o desenho.
      if (barrier) view.blocker.setScale(Math.min(1, (gapBottom - gapTop) / view.blocker.height)).setPosition(center, (gapTop + gapBottom) / 2);
    }

    // Power-up: circulo colorido com um simbolo, flutuando onde apareceu.
    drawPowers(game, graphics) {
      for (const power of game.powers) {
        const x = power.x;
        const y = power.y + 4 * Math.sin(game.elapsed * 5 + power.x / 60);
        const radius = config.powerRadius;
        graphics.fillStyle(0xffffff, 0.9).fillCircle(x, y, radius + 3);
        graphics.fillStyle(powerColors[power.kind]).fillCircle(x, y, radius);
        graphics.fillStyle(0xffffff).lineStyle(2, 0xffffff);
        if (power.kind === "shield") graphics.fillPoints([{ x: x - 7, y: y - 7 }, { x: x + 7, y: y - 7 }, { x: x + 7, y: y + 1 }, { x, y: y + 8 }, { x: x - 7, y: y + 1 }], true);
        else if (power.kind === "slow") graphics.strokeCircle(x, y, 8).lineBetween(x, y, x, y - 6).lineBetween(x, y, x + 5, y);
        else for (const offset of [-6, 0, 6]) graphics.lineBetween(x - 7, y + offset, x + 7, y + offset);
      }
    }

    // Lacaios da fase: sprites reaproveitados, balancando de leve enquanto voam.
    drawMinions(game) {
      while (this.minionImages.length < game.minions.length) this.minionImages.push(this.add.image(0, 0, minionKinds[0]).setDepth(1));
      this.minionImages.forEach((image, index) => {
        const minion = game.minions[index];
        image.setVisible(!!minion);
        if (!minion) return;
        if (image.texture.key !== minion.kind) image.setTexture(minion.kind);
        image.setPosition(minion.x, minion.y + 4 * Math.sin(game.elapsed * 6 + minion.x / 50));
      });
    }

    drawHud(game) {
      const hud = this.hud;
      hud.clear();
      for (let index = 0; index < config.lives; index += 1) {
        const x = 214 + index * 26;
        hud.fillStyle(index < game.lives ? 0xde5a48 : 0xdbe4df);
        hud.fillCircle(x - 5, 30, 6).fillCircle(x + 5, 30, 6).fillTriangle(x - 11, 32, x + 11, 32, x, 44);
      }
      const active = [];
      if (game.shield) active.push(`${t("power.shield")} ${Math.ceil(game.shieldTimer)}s`);
      if (game.slowTimer > 0) active.push(`${t("power.slow")} ${Math.ceil(game.slowTimer)}s`);
      if (game.tripleTimer > 0) active.push(`${t("power.triple")} ${Math.ceil(game.tripleTimer)}s`);
      this.powerText.setText(active.join("  "));
    }

    drawGame() {
      const game = state.game;
      this.showStage(game.currentStage.key);
      this.drawWeather(game);
      const graphics = this.dynamic;
      graphics.clear();
      while (this.pipeViews.length < game.pipes.length) this.pipeViews.push(this.makePipeView());
      this.pipeViews.forEach((view, index) => this.placePipe(view, game.pipes[index]));
      this.drawBoss(game, graphics);
      const [edge, glow, core] = characters[state.character].laser;
      for (const laser of game.lasers) {
        graphics.lineStyle(10, edge).lineBetween(laser.x, laser.y, laser.x + 30, laser.y);
        graphics.lineStyle(5, glow).lineBetween(laser.x, laser.y, laser.x + 30, laser.y);
        graphics.lineStyle(2, core).lineBetween(laser.x, laser.y, laser.x + 30, laser.y);
      }
      for (const impact of game.impacts) {
        graphics.lineStyle(3, glow, impact.remaining / 0.24).strokeCircle(impact.x, impact.y, 8 + (1 - impact.remaining / 0.24) * 28);
      }
      for (const shot of game.projectiles) {
        if (shot.kind !== "bubble") continue;
        graphics.fillStyle(0xbfe8f2, 0.55).fillCircle(shot.x, shot.y, shot.radius);
        graphics.lineStyle(2, 0x2d86a8).strokeCircle(shot.x, shot.y, shot.radius);
        graphics.fillStyle(0xffffff).fillCircle(shot.x - 4, shot.y - 4, 3);
      }
      // Porretes giram; bombas apontam para onde estao caindo.
      const sprites = game.projectiles.filter((shot) => shot.kind !== "bubble");
      while (this.shotImages.length < sprites.length) this.shotImages.push(this.add.image(0, 0, "club").setDepth(1));
      this.shotImages.forEach((image, index) => {
        const shot = sprites[index];
        image.setVisible(!!shot);
        if (!shot) return;
        if (image.texture.key !== shot.kind) image.setTexture(shot.kind);
        const angle = shot.kind === "bomb" ? Phaser.Math.RadToDeg(Math.atan2(shot.velocityY, shot.velocityX)) + 180 : game.elapsed * 270;
        image.setPosition(shot.x, shot.y).setAngle(angle);
      });
      this.drawMinions(game);
      this.drawPowers(game, graphics);
      const blinking = game.invulnerable > 0 && Math.floor(game.elapsed * 12) % 2 === 0;
      this.hero.setY(game.birdY).setAlpha(blinking ? 0.35 : 1).setAngle(game.tracked && !game.paused && !game.finished ? 4 * Math.sin(game.elapsed * 8) : 0);
      // Escudo na cor do personagem; pisca nos 2 s finais.
      if (game.shield && (game.shieldTimer > 2 || Math.floor(game.elapsed * 8) % 2 === 0)) {
        graphics.fillStyle(glow, 0.14).fillCircle(config.birdX, game.birdY, shieldRadius);
        graphics.lineStyle(4, glow, 0.9).strokeCircle(config.birdX, game.birdY, shieldRadius);
        graphics.lineStyle(2, core, 0.9).strokeCircle(config.birdX, game.birdY, shieldRadius - 4);
      }
      if (game.slowTimer > 0) graphics.fillStyle(0x8a5cd6, 0.08).fillRect(0, 88, 820, 522);
      this.drawHud(game);
      this.score.setText(String(game.score).padStart(2, "0"));
      this.best.setText(String(game.best).padStart(2, "0"));
      this.bossTitle.setVisible(!!game.boss).setText(t(`boss.${game.currentStage.boss}`));
      this.health.clear();
      if (game.boss) {
        const step = 210 / game.boss.maxHealth;
        for (let index = 0; index < game.boss.maxHealth; index += 1) this.health.fillStyle(index < game.boss.health ? 0xde5a48 : 0xdbe4df).fillRoundedRect(350 + index * step, 43, step - 4, 15, 2);
      }
    }
  };
}

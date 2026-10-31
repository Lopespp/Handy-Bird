import { Calibration, Game, config, validRange } from "./game.js";
import { characters, createScene } from "./scene.js";
import { HandCamera } from "./camera.js";
import { Sound } from "./sound.js";
import { language, onLanguageChange, setLanguage, t, translatePage } from "./i18n.js";

const element = (id) => document.getElementById(id);
const ui = Object.fromEntries(["language", "sound", "pause", "restart", "fullscreen", "shoot", "side-pause", "side-restart", "camera-toggle", "camera-video", "camera-status", "camera-placeholder", "preview-hero", "overlay-hero", "overlay-steps", "overlay-hint", "live-badge", "overlay", "overlay-title", "overlay-score", "ready-progress", "start", "height-value", "height-meter", "speed-value", "tracking-value", "laser-value", "inference-value", "calibrate", "stage-label", "landmarks", "fatal-error"].map((id) => [id, element(id)]));
// Dados salvos no navegador. Le tambem as chaves de quando o jogo se chamava Flappy Hand.
function load(key) { try { return localStorage.getItem(`handy-bird-${key}`) ?? localStorage.getItem(`flappy-hand-${key}`); } catch { return null; } }
function save(key, value) { try { localStorage.setItem(`handy-bird-${key}`, value); } catch {} }
function storedRange() { try { const range = JSON.parse(load("range")); return validRange(range) ? range : null; } catch { return null; } }
function bestScore() { const value = Number(load("best")); return Number.isInteger(value) && value >= 0 ? value : 0; }
const state = { game: new Game(), character: "handy", mode: "demo", active: false, ready: false, pointerY: 0.5, pointerFist: false, spaceFist: false, camera: null, starting: false, calibration: null, notice: null };
let lastUi = 0;
let storedBest = bestScore();
const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const preview = ui.landmarks.getContext("2d");
const compact = matchMedia("(max-width: 820px)");
const sound = new Sound();

function icons() { globalThis.lucide?.createIcons(); }
function buttonIcon(button, name, label) { button.innerHTML = `<i data-lucide="${name}"></i>${label ? `<span>${label}</span>` : ""}`; icons(); }
// Escreve no HTML so quando o valor muda, evitando recalculos de layout a cada atualizacao.
function setText(element, text) { if (element.textContent !== text) element.textContent = text; }
function showFailure(message) { ui["fatal-error"].hidden = false; ui["fatal-error"].textContent = message; }
function notify(key, failed = false) { state.notice = { until: performance.now() + 4000 }; cameraStatus(key, failed); }
// Status e selo da camera guardam a chave do texto, para trocar de idioma na hora.
let status = { key: "camera.off", failed: false };
function cameraStatus(key, failed = false) { status = { key, failed }; showStatus(); }
function showStatus() { setText(ui["camera-status"], t(status.key)); ui["camera-status"].classList.toggle("error", status.failed); }
let badge = "badge.off";
function setBadge(key) { badge = key; setText(ui["live-badge"], t(key)); }
function showCameraToggle() {
  const on = !!state.camera && !state.starting;
  buttonIcon(ui["camera-toggle"], on ? "video-off" : "video", t(on ? "camera.turnOff" : "start.camera"));
}
function showLanguage() { ui.language.dataset.current = language(); }

function selectCharacter(character) {
  if (!Object.hasOwn(characters, character)) return;
  state.character = character;
  document.querySelector(`input[name="character"][value="${character}"]`).checked = true;
  ui["preview-hero"].src = characters[character].asset;
  ui["preview-hero"].alt = characters[character].name;
  ui["overlay-hero"].src = characters[character].asset;
  state.scene?.selectCharacter(character);
}

// No celular, a previa da camera sai da barra lateral (que fica abaixo da area
// de voo) e flutua sobre o jogo enquanto a webcam esta ativa.
function placePreview() {
  const box = element("preview");
  const heading = document.querySelector(".sidebar .section-heading");
  const floating = compact.matches && !!state.camera && !state.starting;
  box.classList.toggle("floating", floating);
  if (floating && box.parentElement.classList.contains("sidebar")) document.querySelector(".stage").append(box);
  if (!floating && !box.parentElement.classList.contains("sidebar")) heading.after(box);
  if (state.camera && ui["camera-video"].paused) ui["camera-video"].play().catch(() => {});
}

function stopCamera() {
  const camera = state.camera;
  state.camera = null;
  state.starting = false;
  camera?.stop();
  ui["camera-video"].hidden = true;
  ui["preview-hero"].hidden = false;
  ui["camera-placeholder"].hidden = false;
  ui["camera-toggle"].disabled = false;
  ui.calibrate.hidden = true;
  state.calibration = null;
  showCameraToggle();
  placePreview();
}

function selectMode(mode) {
  stopCamera();
  state.mode = mode;
  state.active = false;
  state.pointerFist = false;
  state.spaceFist = false;
  state.game.restart();
  state.game.best = mode === "camera" ? bestScore() : 0;
  state.game.setRange(mode === "camera" ? storedRange() : null);
  state.game.mouse = mode === "demo";
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  setBadge(mode === "camera" ? "badge.off" : "badge.mouse");
  ui.shoot.hidden = mode === "camera";
  cameraStatus(mode === "demo" ? "status.mouse" : "camera.off");
}

async function startCamera() {
  if (state.starting) return;
  selectMode("camera");
  state.starting = true;
  ui["camera-toggle"].disabled = true;
  cameraStatus("status.loading");
  const camera = new HandCamera(ui["camera-video"], (error) => cameraFailed(camera, error));
  state.camera = camera;
  try {
    await camera.start();
    if (state.camera !== camera) { camera.stop(); return; }
    state.starting = false;
    // A camera liga e espera o jogador comecar: botao Jogar ou fechar a mao.
    state.active = false;
    ui["camera-video"].hidden = false;
    ui["preview-hero"].hidden = true;
    ui["camera-placeholder"].hidden = true;
    ui["camera-toggle"].disabled = false;
    setBadge("badge.live");
    showCameraToggle();
    ui.calibrate.hidden = false;
    placePreview();
    cameraStatus("status.searching");
    if (!storedRange()) startCalibration();
  } catch (error) { cameraFailed(camera, error); }
}

function cameraFailed(camera, error) {
  if (state.camera !== camera) return;
  stopCamera();
  state.active = false;
  const messages = { NotAllowedError: "error.denied", NotFoundError: "error.notFound", NotReadableError: "error.busy", AbortError: "error.cancelled" };
  cameraStatus(messages[error.name] ?? (error.message || "error.camera"), true);
  setBadge("badge.unavailable");
}

function startCalibration() {
  if (!state.camera || state.starting) return;
  state.game.restart();
  state.active = true;
  state.calibration = new Calibration();
}

// Depois de calibrar, o voo espera o jogador comecar (botao ou mao fechada).
function finishCalibration() {
  const range = state.calibration.result();
  state.calibration = null;
  state.active = false;
  if (!range) { notify("status.shortMove", true); return; }
  state.game.setRange(range);
  save("range", JSON.stringify(range));
  notify("status.calibrated");
}

function showSound() {
  ui.sound.setAttribute("aria-pressed", String(!sound.muted));
  ui.sound.setAttribute("aria-label", t(sound.muted ? "sound.on" : "sound.off"));
  buttonIcon(ui.sound, sound.muted ? "volume-x" : "volume-2");
}
function toggleSound() { sound.setMuted(!sound.muted); showSound(); }

function restart() { state.calibration = null; state.game.restart(); state.active = state.mode === "demo" || !!state.camera; }
function togglePause() { state.game.togglePause(); }
function start() {
  if (state.mode === "camera" && !state.camera) { startCamera(); return; }
  if (state.game.paused) { state.game.togglePause(); return; }
  restart();
}

// Com a webcam ligada, fechar a mao aciona o botao principal da tela (Jogar,
// Retomar ou Novo voo). So conta depois de ver a mao aberta, para um punho que
// ja estava fechado (atirando) nao reiniciar o voo sem querer.
let fistArmed = false;
function startWithFist(input) {
  const ready = state.mode === "camera" && !!state.camera && !state.starting && !state.calibration
    && !ui.overlay.hidden && !ui.start.hidden && !ui.start.disabled;
  if (!ready || !input?.points?.length) { fistArmed = false; return; }
  if (!input.closed) { fistArmed = true; return; }
  if (fistArmed) { fistArmed = false; start(); }
}

// Sinal de paz (indicador e medio levantados, os outros dobrados) segurado por um
// instante pausa o voo; fechar a mao (ou o botao Retomar) continua.
const peaceHold = 350;
let peaceSince = null;
function pauseWithPeace(input, time) {
  const game = state.game;
  const flying = state.mode === "camera" && !!state.camera && state.active && !state.calibration && !game.paused && !game.finished;
  if (!flying || !input?.peace) { peaceSince = null; return; }
  peaceSince ??= time;
  if (time - peaceSince >= peaceHold) { peaceSince = null; game.paused = true; }
}

// Redesenha os pontos da mao so quando chega um resultado novo ou a faixa muda.
let previewKey = "";
function drawPreview(input) {
  const calibrationKey = state.calibration ? `${state.calibration.min}|${state.calibration.max}` : "";
  const key = `${state.mode}|${!!state.camera}|${state.camera?.resultCount ?? 0}|${input?.points?.length ?? 0}|${input?.closed}|${input?.peace}|${state.game.range.top}|${state.game.range.bottom}|${calibrationKey}`;
  if (key === previewKey) return;
  previewKey = key;
  preview.clearRect(0, 0, 640, 480);
  if (state.mode !== "camera" || !state.camera) return;
  preview.save();
  preview.translate(640, 0); preview.scale(-1, 1);
  const points = input?.points ?? [];
  if (points.length === 21) {
    preview.lineWidth = 2;
    preview.strokeStyle = input.closed ? "#ff836d" : input.peace ? "#ffd23f" : "#3feec1";
    preview.beginPath();
    for (const [first, second] of connections) { preview.moveTo(points[first].x * 640, points[first].y * 480); preview.lineTo(points[second].x * 640, points[second].y * 480); }
    preview.stroke(); preview.fillStyle = "#ffe07f";
    for (const point of points) { preview.beginPath(); preview.arc(point.x * 640, point.y * 480, 3, 0, Math.PI * 2); preview.fill(); }
  }
  preview.strokeStyle = "#ffffff"; preview.setLineDash([6, 6]); preview.beginPath();
  for (const y of [state.game.range.top, state.game.range.bottom]) { preview.moveTo(0, y * 480); preview.lineTo(640, y * 480); }
  preview.stroke();
  const calibration = state.calibration;
  if (calibration && calibration.max >= calibration.min) {
    preview.strokeStyle = "#ff836d"; preview.setLineDash([]); preview.lineWidth = 3; preview.beginPath();
    for (const y of [calibration.min, calibration.max]) { preview.moveTo(0, y * 480); preview.lineTo(640, y * 480); }
    preview.stroke();
  }
  preview.restore();
}

function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }

function inferenceText() {
  const stats = state.camera?.stats;
  if (!stats?.fps) return "--";
  return `${Math.round(stats.fps)} FPS · ${Math.round(stats.latency)} ms · ${stats.delegate ?? "?"}`;
}

function updateUi(time, input) {
  if (state.calibration?.done) finishCalibration();
  pauseWithPeace(input, time);
  startWithFist(input);
  sound.observe(state.game);
  if (time - lastUi < 70) return;
  lastUi = time;
  const game = state.game;
  const height = game.normalizedY === null ? null : Math.round((1 - game.normalizedY) * 100);
  setText(ui["height-value"], height === null ? "--" : `${height}%`);
  if (ui["height-meter"].value !== (height ?? 0)) ui["height-meter"].value = height ?? 0;
  setText(ui["speed-value"], `${game.speed} px/s`);
  setText(ui["tracking-value"], state.mode === "demo" ? "Mouse" : t(game.tracked ? "tracking.hand" : "tracking.none"));
  setText(ui["laser-value"], t(game.shotCooldown > 0 ? "laser.cooling" : "laser.ready"));
  ui["laser-value"].classList.toggle("cooling", game.shotCooldown > 0);
  const stage = game.currentStage;
  setText(ui["stage-label"], t(`stage.${stage.key}`));
  document.getElementById("app").dataset.stage = stage.key;
  ui.overlay.classList.toggle("victory", game.state === "won");
  setText(ui["inference-value"], state.mode === "camera" ? inferenceText() : "--");
  ui.calibrate.disabled = !!state.calibration;
  ui.shoot.classList.toggle("firing", state.pointerFist || state.spaceFist);
  const pauseLabel = t(game.paused ? "start.resume" : "action.pause");
  if (ui.pause.getAttribute("aria-label") !== pauseLabel) {
    ui.pause.setAttribute("aria-label", pauseLabel); ui.pause.title = `${pauseLabel} (P)`;
    buttonIcon(ui.pause, game.paused ? "play" : "pause");
    buttonIcon(ui["side-pause"], game.paused ? "play" : "pause", pauseLabel);
  }
  const handVisible = !!input?.points?.length;
  if (state.notice && time > state.notice.until) state.notice = null;
  if (state.camera && !state.starting && !state.notice) cameraStatus(handVisible ? (input.closed ? "status.closed" : input.peace ? "status.peace" : "status.open") : "status.searching");
  const calibrating = !!state.calibration;
  ui.overlay.hidden = !calibrating && state.active && game.state === "playing" && game.tracked && !game.paused;
  ui["overlay-score"].hidden = !game.finished && !calibrating;
  // Passos de como comecar so aparecem antes do primeiro voo.
  ui["overlay-steps"].hidden = state.active || !!state.camera || game.finished || calibrating || state.starting;
  setText(ui["overlay-score"], calibrating
    ? t(handVisible ? "calib.move" : "calib.show")
    : game.state === "won" ? t("score.time", { score: game.score, time: formatTime(game.elapsed) }) : t("score.points", { score: game.score }));
  const preparing = state.active && game.state === "ready" && game.tracked && !game.paused;
  ui["ready-progress"].hidden = !preparing && !calibrating;
  ui["ready-progress"].value = calibrating ? state.calibration.progress : game.readyElapsed;
  ui.start.hidden = calibrating || preparing || (state.active && !game.tracked && !game.paused && !game.finished);
  ui.start.disabled = state.starting;
  ui["overlay-hint"].hidden = ui.start.hidden || state.mode !== "camera" || !state.camera || state.starting;
  setText(ui["overlay-title"], t(state.starting ? "overlay.loading" : calibrating ? "overlay.calibrating" : !state.active ? "overlay.ready" : game.state === "won" ? "overlay.won" : game.state === "over" ? "overlay.over" : game.paused ? "overlay.paused" : !game.tracked ? "overlay.noHand" : "overlay.preparing"));
  const startKey = game.paused ? "start.resume" : game.finished ? "start.again" : state.mode === "camera" && !state.camera ? "start.camera" : "start.play";
  const startIcon = { "start.resume": "play", "start.again": "rotate-ccw", "start.camera": "video", "start.play": "play" }[startKey];
  if (ui.start.textContent.trim() !== t(startKey)) buttonIcon(ui.start, startIcon, t(startKey));
  drawPreview(input);
  if (state.mode === "camera" && game.best > storedBest) {
    storedBest = game.best;
    save("best", String(storedBest));
  }
}

document.querySelectorAll('input[name="character"]').forEach((radio) => radio.addEventListener("change", () => selectCharacter(radio.value)));
document.querySelectorAll('input[name="mode"]').forEach((radio) => radio.addEventListener("change", () => { if (radio.value === "camera") startCamera(); else selectMode("demo"); }));
ui["camera-toggle"].addEventListener("click", () => { if (state.camera) { selectMode("demo"); } else startCamera(); });
ui.start.addEventListener("click", start);
ui.calibrate.addEventListener("click", startCalibration);
ui.sound.addEventListener("click", toggleSound);
ui.language.addEventListener("click", () => setLanguage(language() === "en" ? "pt" : "en"));
// Textos que o JavaScript escreve (e nao so o HTML marcado) tambem mudam de idioma.
onLanguageChange(() => {
  showSound(); showCameraToggle(); setBadge(badge); showStatus(); showLanguage();
  lastUi = 0;
  state.scene?.translate();
});
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, () => sound.unlock(), { capture: true });
for (const id of ["restart", "side-restart"]) ui[id].addEventListener("click", restart);
for (const id of ["pause", "side-pause"]) ui[id].addEventListener("click", togglePause);
ui.fullscreen.addEventListener("click", async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { showFailure(t("error.fullscreen")); }
});
ui.shoot.addEventListener("pointerdown", (event) => { event.preventDefault(); state.pointerFist = true; ui.shoot.setPointerCapture(event.pointerId); });
window.addEventListener("pointerup", () => { state.pointerFist = false; });
window.addEventListener("pointercancel", () => { state.pointerFist = false; });
window.addEventListener("keydown", (event) => {
  if (event.target.closest("input, button, select")) return;
  if (event.code === "Space") { event.preventDefault(); state.spaceFist = true; }
  if (event.repeat) return;
  if (event.code === "KeyP") togglePause();
  if (event.code === "KeyR") restart();
  if (event.code === "KeyM") toggleSound();
});
window.addEventListener("keyup", (event) => { if (event.code === "Space") state.spaceFist = false; });
window.addEventListener("blur", () => { state.spaceFist = false; state.pointerFist = false; if (state.active && !state.game.finished) state.game.paused = true; });
document.addEventListener("visibilitychange", () => { if (document.hidden) { state.spaceFist = false; state.pointerFist = false; if (state.active && !state.game.finished) state.game.paused = true; } });
window.addEventListener("pagehide", stopCamera);
compact.addEventListener("change", placePreview);
window.addEventListener("load", () => { showSound(); icons(); });

translatePage();
showLanguage();
// O site abre no modo Webcam; a camera so liga quando o jogador clicar.
selectMode("camera");

// Espera a fonte pixelada (no maximo 1,5 s) para os textos do jogo ja nascerem com ela.
async function fontsReady() {
  const fonts = document.fonts ? Promise.all(['700 30px "Fredoka"', '600 13px "Fredoka"', '700 30px "Pixelify Sans"'].map((font) => document.fonts.load(font))) : Promise.resolve();
  await Promise.race([fonts.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1500))]);
}

if (!globalThis.Phaser) showFailure(t("error.load"));
else fontsReady().then(() => {
  new Phaser.Game({
    // WebGL desenha os sprites na GPU; sem suporte, o Phaser volta para Canvas.
    type: Phaser.AUTO, parent: "game", width: config.width, height: config.height, backgroundColor: "#dcf1ee",
    transparent: false, audio: { noAudio: true }, render: { antialias: false, roundPixels: true, powerPreference: "high-performance" },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    fps: { target: 60, forceSetTimeOut: false },
    scene: createScene(state, updateUi, (pixelY) => { state.pointerY = 0.15 + 0.7 * Math.max(0, Math.min(1, (pixelY - 109) / 480)); }, showFailure),
  });
});

export { pauseWithPeace, sound, startWithFist, state };
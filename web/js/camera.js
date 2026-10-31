import { HandLock, isFistClosed, isPeaceSign, palmCenter } from "./game.js";
import { t } from "./i18n.js";

export class HandCamera {
  constructor(video, onError) {
    this.video = video;
    this.onError = onError;
    this.running = false;
    this.points = [];
    this.closed = false;
    this.peace = false;
    this.updatedAt = 0;
    this.lastCapture = 0;
    this.busy = false;
    this.handY = null;
    this.lock = new HandLock();
    this.stats = { fps: 0, latency: 0, inference: 0, delegate: null };
    this.sentAt = 0;
    this.resultAt = 0;
  }

  async start() {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error(t("error.https"));
    this.running = true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
    if (!this.running) { stream.getTracks().forEach((track) => track.stop()); throw new DOMException("Cancelado", "AbortError"); }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    if (!this.running) return;
    stream.getVideoTracks()[0].addEventListener("ended", () => { if (this.running) this.onError(new Error(t("error.disconnected"))); });
    this.worker = new Worker(new URL("./tracking-worker.js", import.meta.url));
    await new Promise((resolve, reject) => {
      this.rejectReady = reject;
      this.readyTimer = setTimeout(() => reject(new Error(t("error.timeout"))), 45000);
      this.worker.onerror = () => { const error = new Error(t("error.tracking")); reject(error); this.onError(error); };
      this.worker.onmessage = ({ data }) => {
        if (data.type === "ready") { clearTimeout(this.readyTimer); this.rejectReady = null; this.stats.delegate = data.delegate; resolve(); }
        if (data.type === "delegate") this.stats.delegate = data.delegate;
        if (data.type === "error") { const error = new Error(data.message || t("error.tracking")); reject(error); this.onError(error); }
        if (data.type === "result") {
          this.busy = false;
          const now = performance.now();
          this.updatedAt = now;
          this.resultCount = (this.resultCount ?? 0) + 1;
          this.measure(now, data.inference);
          this.points = this.lock.accept(data.points, data.handedness, now / 1000) ? data.points : [];
          this.handY = palmCenter(this.points)?.y ?? null;
          const aspectRatio = this.video.videoWidth / this.video.videoHeight;
          this.closed = isFistClosed(this.points, aspectRatio, this.closed);
          this.peace = !this.closed && isPeaceSign(this.points, aspectRatio);
        }
      };
      this.worker.postMessage({ type: "init" });
    });
    if (!this.running) return;
    // Envia cada quadro novo da camera assim que ele chega (requestVideoFrameCallback),
    // sem esperar o proximo quadro da tela nem descartar quadros por variacao de tempo.
    // Sem suporte, verifica a cada quadro da tela. So um quadro fica em analise por vez.
    const schedule = () => {
      if (!this.running) return;
      if (this.video.requestVideoFrameCallback) this.frameRequest = this.video.requestVideoFrameCallback(capture);
      else this.animation = requestAnimationFrame(capture);
    };
    const capture = async () => {
      schedule();
      const now = performance.now();
      if (document.hidden || this.busy || this.video.readyState < 2 || now - this.lastCapture < 15) return;
      this.lastCapture = now;
      this.busy = true;
      try {
        this.sentAt = now;
        const image = await createImageBitmap(this.video);
        if (!this.running) { image.close(); return; }
        this.worker.postMessage({ type: "frame", image, timestamp: now }, [image]);
      } catch (error) { this.busy = false; if (this.running) this.onError(error); }
    };
    schedule();
  }

  // Medias moveis de FPS de inferencia, latencia (captura ate resultado) e
  // tempo do modelo, para o painel lateral.
  measure(now, inference) {
    const blend = (previous, value) => previous ? previous + 0.1 * (value - previous) : value;
    if (this.resultAt) this.stats.fps = blend(this.stats.fps, 1000 / Math.max(1, now - this.resultAt));
    this.resultAt = now;
    this.stats.latency = blend(this.stats.latency, now - this.sentAt);
    if (Number.isFinite(inference)) this.stats.inference = blend(this.stats.inference, inference);
  }

  read() {
    const fresh = this.running && performance.now() - this.updatedAt <= 350;
    return { handY: fresh ? this.handY : null, closed: fresh && this.closed, peace: fresh && this.peace, points: fresh ? this.points : [] };
  }

  stop() {
    this.running = false;
    clearTimeout(this.readyTimer);
    this.rejectReady?.(new DOMException("Cancelado", "AbortError"));
    this.rejectReady = null;
    cancelAnimationFrame(this.animation);
    if (this.frameRequest !== undefined) this.video.cancelVideoFrameCallback?.(this.frameRequest);
    this.worker?.terminate();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    this.points = [];
    this.handY = null;
    this.closed = false;
    this.peace = false;
    this.lock.reset();
  }
}
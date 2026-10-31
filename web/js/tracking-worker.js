const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
let detector = null;
let delegate = null;
let files = null;
let HandLandmarker = null;

async function createDetector(choice) {
  detector?.close();
  detector = null;
  detector = await HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate: choice },
    // Limiares um pouco menores mantem o rastreamento em movimentos rapidos (borrao),
    // evitando refazer a deteccao da palma, que e a etapa mais cara do modelo.
    runningMode: "VIDEO", numHands: 1, minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  // A primeira inferencia na GPU compila os shaders e pode levar segundos.
  // Aquecer aqui mantem esse custo na tela de carregamento, nao no jogo.
  const blank = new OffscreenCanvas(64, 48);
  blank.getContext("2d").fillRect(0, 0, 64, 48);
  detector.detectForVideo(blank, 0);
  delegate = choice;
}

function detect(image, timestamp) {
  const started = performance.now();
  const result = detector.detectForVideo(image, timestamp);
  return {
    type: "result", points: result.landmarks[0] ?? [],
    handedness: result.handedness?.[0]?.[0]?.categoryName ?? null,
    inference: performance.now() - started,
  };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const vision = await import(`${VISION}/vision_bundle.mjs`);
      HandLandmarker = vision.HandLandmarker;
      files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
      // A GPU costuma ser bem mais rapida; sem WebGL2 no worker, volta para a CPU.
      if (data.delegate === "CPU") await createDetector("CPU");
      else try { await createDetector("GPU"); } catch { await createDetector("CPU"); }
      self.postMessage({ type: "ready", delegate });
    } else if (data.type === "frame" && detector) {
      let message;
      try { message = detect(data.image, data.timestamp); }
      catch (error) {
        if (delegate !== "GPU") throw error;
        // Alguns drivers criam o contexto GPU, mas falham na inferencia.
        await createDetector("CPU");
        self.postMessage({ type: "delegate", delegate });
        message = detect(data.image, data.timestamp);
      }
      self.postMessage(message);
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "" });
  } finally {
    data.image?.close();
  }
};

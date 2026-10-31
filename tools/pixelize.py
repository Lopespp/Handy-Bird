"""Converte uma imagem de referencia em pixel art fiel para os sprites do jogo.

Uso:
    python tools/pixelize.py ENTRADA SAIDA --width 48 [--colors 16] [--scale 4]
        [--background white|none] [--crop x,y,largura,altura]

O processo preserva o desenho original: recorta, remove o fundo, reduz a
resolucao pela media de area, limita a paleta com k-means, adiciona contorno
escuro de 1 pixel e amplia sem suavizar (vizinho mais proximo).
"""

import argparse
from pathlib import Path

import cv2
import numpy as np


def remove_background(image: np.ndarray, mode: str) -> np.ndarray:
    if image.shape[2] == 4 or mode == "none":
        return image if image.shape[2] == 4 else cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    # Fundo branco: remove apenas o branco ligado a borda, preservando
    # brilhos e detalhes brancos dentro do personagem.
    bgr = image[:, :, :3]
    light = np.all(bgr >= 232, axis=2).astype(np.uint8)
    mask = np.zeros((bgr.shape[0] + 2, bgr.shape[1] + 2), np.uint8)
    flooded = light.copy()
    for x, y in ((0, 0), (bgr.shape[1] - 1, 0), (0, bgr.shape[0] - 1), (bgr.shape[1] - 1, bgr.shape[0] - 1)):
        if flooded[y, x] == 1:
            cv2.floodFill(flooded, mask, (x, y), 2)
    alpha = np.where(flooded == 2, 0, 255).astype(np.uint8)
    return np.dstack([bgr, alpha])


def pixelize(image: np.ndarray, width: int, colors: int) -> np.ndarray:
    height = max(1, round(image.shape[0] * width / image.shape[1]))
    alpha = image[:, :, 3].astype(np.float32) / 255
    # Media ponderada pelo alfa, para o fundo nao clarear as bordas.
    premultiplied = image[:, :, :3].astype(np.float32) * alpha[:, :, None]
    small_color = cv2.resize(premultiplied, (width, height), interpolation=cv2.INTER_AREA)
    small_alpha = cv2.resize(alpha, (width, height), interpolation=cv2.INTER_AREA)
    opaque = small_alpha >= 0.5
    color = small_color / np.maximum(small_alpha, 1e-6)[:, :, None]
    pixels = color[opaque].reshape(-1, 3).astype(np.float32)
    palette_size = min(colors, len(pixels))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    _, labels, centers = cv2.kmeans(pixels, palette_size, None, criteria, 4, cv2.KMEANS_PP_CENTERS)
    quantized = np.zeros((height, width, 4), np.uint8)
    quantized[opaque, :3] = np.clip(centers[labels.flatten()], 0, 255).astype(np.uint8)
    quantized[opaque, 3] = 255
    return quantized


def outline(sprite: np.ndarray) -> np.ndarray:
    padded = np.pad(sprite, ((1, 1), (1, 1), (0, 0)))
    solid = padded[:, :, 3] > 0
    grown = cv2.dilate(solid.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    edge = grown & ~solid
    padded[edge] = (28, 26, 30, 255)
    return padded


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--width", type=int, required=True, help="Largura em pixels de arte, antes de ampliar.")
    parser.add_argument("--colors", type=int, default=16)
    parser.add_argument("--scale", type=int, default=4)
    parser.add_argument("--background", choices=("white", "none"), default="white")
    parser.add_argument("--crop", help="x,y,largura,altura na imagem original.")
    options = parser.parse_args()
    image = cv2.imread(str(options.source), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SystemExit(f"Nao foi possivel abrir {options.source}")
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    if options.crop:
        x, y, w, h = (int(value) for value in options.crop.split(","))
        image = image[y:y + h, x:x + w]
    sprite = outline(pixelize(remove_background(image, options.background), options.width, options.colors))
    bounds = cv2.boundingRect((sprite[:, :, 3] > 0).astype(np.uint8))
    x, y, w, h = bounds
    sprite = np.pad(sprite[y:y + h, x:x + w], ((1, 1), (1, 1), (0, 0)))
    large = cv2.resize(sprite, (sprite.shape[1] * options.scale, sprite.shape[0] * options.scale), interpolation=cv2.INTER_NEAREST)
    options.target.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(options.target), large, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    print(f"{options.target}: {sprite.shape[1]}x{sprite.shape[0]} pixels de arte, {large.shape[1]}x{large.shape[0]} px")


if __name__ == "__main__":
    main()

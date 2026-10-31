"""Remove o fundo branco de uma ilustracao e gera sprites prontos para o jogo.

Uso:
    python tools/cutout.py art/source/handy.jpg web/assets/characters/handy.png --width 256
    python tools/cutout.py RECORTE.png SAIDA.png --width 62 --fill-holes 200
    python tools/cutout.py ENTRADA SAIDA --width 210 [--split-bomb BOMBA.png --bomb-width 40]

So o branco ligado a borda vira transparente, preservando brilhos e detalhes
brancos dentro do desenho. Com --split-bomb, o maior objeto vira o sprite
principal e o segundo maior (a bomba pendurada) vira um sprite separado; o fio
fino entre os dois e descartado.
"""

import argparse
from pathlib import Path

import cv2
import numpy as np


def foreground_mask(image: np.ndarray, holes: int = 0) -> np.ndarray:
    light = (image.min(axis=2) >= 225).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(light, connectivity=4)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    background = np.isin(labels, border[border != 0]) & (light == 1)
    if holes:
        # Bolsoes de fundo presos pelo contorno (ex.: entre o taco e o corpo).
        enclosed = [label for label in range(1, count) if stats[label, cv2.CC_STAT_AREA] >= holes]
        background |= np.isin(labels, enclosed)
    mask = (~background).astype(np.uint8)
    # Remove o halo claro do JPEG em volta do contorno.
    return cv2.erode(mask, np.ones((3, 3), np.uint8))


def sprite(image: np.ndarray, mask: np.ndarray, width: int) -> np.ndarray:
    x, y, w, h = cv2.boundingRect(mask)
    crop = image[y:y + h, x:x + w].astype(np.float32)
    alpha = mask[y:y + h, x:x + w].astype(np.float32)
    height = max(1, round(h * width / w))
    color = cv2.resize(crop * alpha[:, :, None], (width, height), interpolation=cv2.INTER_AREA)
    small_alpha = cv2.resize(alpha, (width, height), interpolation=cv2.INTER_AREA)
    color = color / np.maximum(small_alpha, 1e-6)[:, :, None]
    result = np.dstack([np.clip(color, 0, 255), np.where(small_alpha >= 0.5, 255, 0)]).astype(np.uint8)
    result[result[:, :, 3] == 0, :3] = 0
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--width", type=int, required=True, help="Largura final do sprite em pixels.")
    parser.add_argument("--split-bomb", type=Path, help="Salva o segundo maior objeto como sprite separado.")
    parser.add_argument("--bomb-width", type=int, default=40)
    parser.add_argument("--fill-holes", type=int, default=0, help="Tambem remove areas brancas fechadas com pelo menos N pixels.")
    options = parser.parse_args()
    image = cv2.imread(str(options.source), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"Nao foi possivel abrir {options.source}")
    mask = foreground_mask(image, options.fill_holes)
    if options.split_bomb:
        kernel = np.ones((9, 9), np.uint8)
        opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(opened)
        order = np.argsort(stats[1:, cv2.CC_STAT_AREA])[::-1] + 1
        main_mask = mask & cv2.dilate((labels == order[0]).astype(np.uint8), kernel)
        bomb_mask = mask & cv2.dilate((labels == order[1]).astype(np.uint8), kernel)
        options.split_bomb.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(options.split_bomb), sprite(image, bomb_mask, options.bomb_width), [cv2.IMWRITE_PNG_COMPRESSION, 9])
        mask = main_mask
    result = sprite(image, mask, options.width)
    options.target.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(options.target), result, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    print(f"{options.target}: {result.shape[1]}x{result.shape[0]} px")


if __name__ == "__main__":
    main()

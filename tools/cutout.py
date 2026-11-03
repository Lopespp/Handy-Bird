"""Remove o fundo branco de uma ilustracao e gera sprites prontos para o jogo.

Uso:
    python tools/cutout.py art/source/handy.jpg web/assets/characters/handy.png --width 256
    python tools/cutout.py art/source/valley_warden.jpg web/assets/bosses/valley_warden.png --height 240 --fill-holes 200
    python tools/cutout.py art/source/minions.jpg web/assets/minions/dartwig.png --height 60 --pick 1 --of 3
    python tools/cutout.py ENTRADA SAIDA --width 210 [--split-bomb BOMBA.png --bomb-width 40]

So o branco ligado a borda vira transparente, preservando brilhos e detalhes
brancos dentro do desenho. Com --fill-holes, bolsoes de fundo presos pelo
contorno (ex.: entre as pernas) tambem somem; areas so claras, como a barriga
de um tubarao, ficam. Com --pick, a imagem e uma folha com varios desenhos lado
a lado e so o escolhido (contando da esquerda) vira sprite. Com --split-bomb, o
maior objeto vira o sprite principal e o segundo maior vira um sprite separado.
"""

import argparse
from pathlib import Path

import cv2
import numpy as np


def foreground_mask(image: np.ndarray, holes: int = 0) -> np.ndarray:
    lightness = image.min(axis=2)
    light = (lightness >= 225).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(light, connectivity=4)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    background = np.isin(labels, border[border != 0]) & (light == 1)
    if holes:
        # So bolsoes quase brancos contam como fundo; partes claras do desenho ficam.
        brightness = np.bincount(labels.ravel(), weights=lightness.ravel(), minlength=count) / np.maximum(stats[:, cv2.CC_STAT_AREA], 1)
        enclosed = [label for label in range(1, count) if stats[label, cv2.CC_STAT_AREA] >= holes and brightness[label] >= 245]
        background |= np.isin(labels, enclosed)
    mask = (~background).astype(np.uint8)
    # Remove o halo claro do JPEG em volta do contorno.
    return cv2.erode(mask, np.ones((3, 3), np.uint8))


def pick(mask: np.ndarray, index: int, total: int) -> np.ndarray:
    # Junta pedacos proximos do mesmo desenho e fica com os `total` maiores grupos.
    grouped = cv2.dilate(mask, np.ones((15, 15), np.uint8))
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(grouped)
    largest = np.argsort(stats[1:, cv2.CC_STAT_AREA])[::-1][:total] + 1
    if len(largest) < total:
        raise SystemExit(f"A folha tem {len(largest)} desenhos, nao {total}")
    chosen = sorted(largest, key=lambda label: centroids[label][0])[index - 1]
    return mask & (labels == chosen).astype(np.uint8)


def sprite(image: np.ndarray, mask: np.ndarray, width: int = 0, height: int = 0) -> np.ndarray:
    x, y, w, h = cv2.boundingRect(mask)
    crop = image[y:y + h, x:x + w].astype(np.float32)
    alpha = mask[y:y + h, x:x + w].astype(np.float32)
    if height:
        width = max(1, round(w * height / h))
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
    size = parser.add_mutually_exclusive_group(required=True)
    size.add_argument("--width", type=int, help="Largura final do sprite em pixels.")
    size.add_argument("--height", type=int, help="Altura final do sprite em pixels.")
    parser.add_argument("--pick", type=int, help="Numero do desenho na folha, da esquerda para a direita.")
    parser.add_argument("--of", type=int, default=1, help="Quantos desenhos a folha tem.")
    parser.add_argument("--split-bomb", type=Path, help="Salva o segundo maior objeto como sprite separado.")
    parser.add_argument("--bomb-width", type=int, default=40)
    parser.add_argument("--fill-holes", type=int, default=0, help="Tambem remove areas brancas fechadas com pelo menos N pixels.")
    options = parser.parse_args()
    image = cv2.imread(str(options.source), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"Nao foi possivel abrir {options.source}")
    mask = foreground_mask(image, options.fill_holes)
    if options.pick:
        mask = pick(mask, options.pick, options.of)
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
    result = sprite(image, mask, options.width or 0, options.height or 0)
    options.target.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(options.target), result, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    print(f"{options.target}: {result.shape[1]}x{result.shape[0]} px")


if __name__ == "__main__":
    main()

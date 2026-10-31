"""Gera os sprites de canos e bloqueios de cada fase a partir das ilustracoes.

Uso:
    python tools/pipes.py art/source/canos.jpg art/source/bloqueios.jpg web/assets/stages

Cada imagem tem tres colunas (Vale Verde, Praia Tropical, Tempestade Final).
Na imagem dos canos, a linha de cima e a ponta do cano que desce do teto e a
de baixo, a ponta do cano que sobe do chao. Para cada fase sao gerados:

- pipe-<fase>-body.png: faixa do corpo, repetida na vertical ate o teto/chao;
- pipe-<fase>-top.png e pipe-<fase>-bottom.png: pontas com a borda;
- blocker-<fase>.png: o bloqueio que fecha o vao (substitui a placa vermelha).

Todos sao reduzidos para que o corpo tenha exatamente a largura do cano no jogo
(76 px) e centralizados no corpo. pipes.json guarda em que linha de cada ponta
fica a borda, para alinhar a borda com o vao.
"""

import json
from pathlib import Path
import sys

import cv2
import numpy as np

PIPE_WIDTH = 76
STAGES = ("valley", "beach", "storm")
COLUMNS = ((0, 680), (680, 1340), (1340, 2000))
BODY_ROWS = (230, 330)
# Faixa limpa do corpo (sem emendas nem sombras) usada para repetir ate o teto/chao.
TILE_ROWS = (1210, 1340)


def mask_without_background(image: np.ndarray, body_spans: list[tuple[int, int]]) -> np.ndarray:
    light = (image.min(axis=2) >= 225).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(light, connectivity=4)
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    background = np.zeros(light.shape, bool)
    for label in range(1, count):
        x, width = stats[label, cv2.CC_STAT_LEFT], stats[label, cv2.CC_STAT_WIDTH]
        outside_body = not any(left + 10 <= x and x + width <= right - 10 for left, right in body_spans)
        # Fundo: branco ligado a borda ou furinhos brancos fora do cano (rede, cordas).
        if label in border or (outside_body and stats[label, cv2.CC_STAT_AREA] < 20000):
            background |= labels == label
    mask = (~background).astype(np.uint8)
    return cv2.erode(mask, np.ones((3, 3), np.uint8))


def extents(mask: np.ndarray, rows: range, x0: int, x1: int) -> tuple[int, int]:
    lefts, rights = [], []
    for y in rows:
        xs = np.flatnonzero(mask[y, x0:x1])
        if len(xs):
            lefts.append(xs[0] + x0)
            rights.append(xs[-1] + x0)
    return int(np.median(lefts)), int(np.median(rights))


def rows_with_content(mask: np.ndarray, rows: range, x0: int, x1: int) -> list[int]:
    return [y for y in rows if mask[y, x0:x1].any()]


def full_rows(mask: np.ndarray, rows: range, left: int, right: int) -> list[int]:
    return [y for y in rows if mask[y, left:right + 1].mean() >= 0.9]


def cut(image, mask, top, bottom, center, x0, x1, scale) -> np.ndarray:
    """Recorta simetrico em torno do centro do corpo e reduz pela escala do jogo."""
    xs = np.flatnonzero(mask[top:bottom, x0:x1].any(axis=0)) + x0
    half = int(np.ceil(max(center - xs[0], xs[-1] - center))) + 1
    left, right = int(round(center - half)), int(round(center + half))
    crop = image[top:bottom, left:right].astype(np.float32)
    alpha = mask[top:bottom, left:right].astype(np.float32)
    size = (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale)))
    color = cv2.resize(crop * alpha[:, :, None], size, interpolation=cv2.INTER_AREA)
    small = cv2.resize(alpha, size, interpolation=cv2.INTER_AREA)
    color = color / np.maximum(small, 1e-6)[:, :, None]
    sprite = np.dstack([np.clip(color, 0, 255), np.where(small >= 0.5, 255, 0)]).astype(np.uint8)
    sprite[sprite[:, :, 3] == 0, :3] = 0
    return sprite


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    pipes = cv2.imread(sys.argv[1])
    blockers = cv2.imread(sys.argv[2])
    outputs = [Path(folder) for folder in sys.argv[3:]]
    spans = []
    for x0, x1 in COLUMNS:
        light = (pipes.min(axis=2) < 225).astype(np.uint8)
        spans.append(extents(light, range(*BODY_ROWS), x0, x1))
    pipe_mask = mask_without_background(pipes, spans)
    blocker_mask = mask_without_background(blockers, spans)
    meta = {}
    files = {}
    half_height = pipes.shape[0] // 2
    for stage, (x0, x1) in zip(STAGES, COLUMNS):
        body_left, body_right = extents(pipe_mask, range(*BODY_ROWS), x0, x1)
        scale = PIPE_WIDTH / (body_right - body_left + 1)
        center = (body_left + body_right) / 2
        # Corpo: faixa limpa do cano, com a largura exata do cano no jogo.
        tile_left, tile_right = extents(pipe_mask, range(*TILE_ROWS), x0, x1)
        body = pipes[TILE_ROWS[0]:TILE_ROWS[1], tile_left:tile_right + 1]
        tile_height = max(1, round(body.shape[0] * PIPE_WIDTH / (tile_right - tile_left + 1)))
        files[f"pipe-{stage}-body.png"] = np.dstack([
            cv2.resize(body, (PIPE_WIDTH, tile_height), interpolation=cv2.INTER_AREA),
            np.full((tile_height, PIPE_WIDTH), 255, np.uint8),
        ])
        # Ponta de cima: do corpo ate as decoracoes abaixo da borda.
        lip_left, lip_right = extents(pipe_mask, range(520, 580), x0, x1)
        top_rows = rows_with_content(pipe_mask, range(BODY_ROWS[0], half_height), x0, x1)
        top_end = top_rows[-1] + 1
        lip_rows = set(full_rows(pipe_mask, range(440, top_end), lip_left, lip_right))
        lip_bottom = max(lip_rows)
        # Inicio do anel da borda (linhas contiguas com a largura da borda).
        ring_start = lip_bottom
        while ring_start - 1 in lip_rows:
            ring_start -= 1
        files[f"pipe-{stage}-top.png"] = cut(pipes, pipe_mask, BODY_ROWS[0], top_end, center, x0, x1, scale)
        # Ponta de baixo: das decoracoes acima da borda ate o corpo limpo.
        bottom_body_left, bottom_body_right = extents(pipe_mask, range(1220, 1340), x0, x1)
        bottom_scale = PIPE_WIDTH / (bottom_body_right - bottom_body_left + 1)
        bottom_center = (bottom_body_left + bottom_body_right) / 2
        bottom_lip = extents(pipe_mask, range(940, 1000), x0, x1)
        bottom_start = rows_with_content(pipe_mask, range(half_height, 1100), x0, x1)[0]
        lip_top = full_rows(pipe_mask, range(bottom_start, 1060), *bottom_lip)[0]
        files[f"pipe-{stage}-bottom.png"] = cut(pipes, pipe_mask, bottom_start, 1200, bottom_center, x0, x1, bottom_scale)
        # Bloqueio: linhas em que o desenho fica mais largo que o corpo.
        b_left, b_right = extents(blocker_mask, range(*BODY_ROWS), x0, x1)
        b_scale = PIPE_WIDTH / (b_right - b_left + 1)
        wide = [y for y in range(300, 1340)
                if (xs := np.flatnonzero(blocker_mask[y, x0:x1])).size and xs[-1] - xs[0] > (b_right - b_left) * 1.06]
        files[f"blocker-{stage}.png"] = cut(blockers, blocker_mask, wide[0], wide[-1] + 1, (b_left + b_right) / 2, x0, x1, b_scale)
        meta[stage] = {
            "topLip": round((lip_bottom + 1 - BODY_ROWS[0]) * scale),
            # Onde comeca o anel na ponta de cima (com 4 px das plantas logo acima):
            # o mesmo anel marca o fim do vao quando ha bloqueio.
            "ringTop": max(0, round((ring_start - BODY_ROWS[0]) * scale) - 4),
            "bottomLip": round((lip_top - bottom_start) * bottom_scale),
        }
    for folder in outputs:
        folder.mkdir(parents=True, exist_ok=True)
        for name, sprite in files.items():
            cv2.imwrite(str(folder / name), sprite, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        (folder / "pipes.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    for name, sprite in files.items():
        print(f"{name}: {sprite.shape[1]}x{sprite.shape[0]}")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()

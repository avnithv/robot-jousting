#!/usr/bin/env python3
"""Slice the three source sprite sheets into individual transparent PNGs + JSON atlases.

    python3 tools/slice_sheets.py            # writes assets/sprites, assets/town, assets/arms (+ atlas.json each)
    python3 tools/slice_sheets.py --contact  # also writes indexed contact sheets to tools/contact_*.png

Method: connected components of the "ink" mask (alpha > thresh; for the white-background barkeep sheet the
alpha is synthesised from distance-to-white). For the two regular sheets every component is assigned to the
grid cell that contains its centre and the boxes are unioned per cell, so a pose plus its separate sparkle
glyph stays one sprite. The town sheet has no grid: components are lightly dilated so multi-stroke objects
merge, then ordered top-to-bottom, left-to-right. Each cell is trimmed to its ink and saved with alpha.
"""
import argparse, json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "assets", "raw")

def load_rgba(path, white_bg):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.int16)
    if white_bg:  # alpha from distance to white: min channel <= 232 -> opaque, >= 248 -> transparent
        mn = a[..., :3].min(axis=2)
        alpha = np.clip((248 - mn) * (255 / 16), 0, 255)
        # un-blend the white: edge pixels are sprite colour mixed with white, recover the sprite colour
        al = np.maximum(alpha, 1)[..., None] / 255.0
        rgb = np.clip((a[..., :3] - (1 - al) * 255) / al, 0, 255)
        # shave the outermost pixel so the painting's light outline does not read as a halo on dark backgrounds
        alpha = np.minimum(alpha, ndimage.minimum_filter(alpha, size=3) + 90)
        a[..., :3] = np.where(alpha[..., None] > 0, rgb, a[..., :3]); a[..., 3] = alpha
    return Image.fromarray(a.astype(np.uint8), "RGBA")

LABELS = None   # label image of the sheet currently being sliced (component id per pixel, 0 = background)

def components(im, thresh, dilate, min_area):
    global LABELS
    a = np.asarray(im)[..., 3]; m = a > thresh
    md = ndimage.binary_dilation(m, iterations=dilate) if dilate else m
    lab, _ = ndimage.label(md); LABELS = lab; boxes = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None: continue
        sub = m[sl] & (lab[sl] == i)
        if sub.sum() < min_area: continue
        ys, xs = np.where(sub)
        boxes.append([int(sl[1].start + xs.min()), int(sl[0].start + ys.min()), int(sl[1].start + xs.max() + 1), int(sl[0].start + ys.max() + 1), i])
    return boxes

def ids(b): return b[4] if isinstance(b[4], list) else [b[4]]
def union(boxes): return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes), sum((ids(b) for b in boxes), [])]

def pad_box(b, im, pad): return [max(b[0] - pad, 0), max(b[1] - pad, 0), min(b[2] + pad, im.width), min(b[3] + pad, im.height), ids(b)]

def split_wide(im, b, max_w):
    """A component wider than max_w is two sprites touching (a motion arc grazing the next arm): cut it at the
    thinnest ink column in its middle half and recurse. Returns a list of boxes (same component id)."""
    x0, y0, x1, y1, cid = b
    if x1 - x0 <= max_w: return [b]
    m = (LABELS[y0:y1, x0:x1] == cid); prof = m.sum(axis=0); lo, hi = int(len(prof) * 0.25), int(len(prof) * 0.75)
    cut = lo + int(np.argmin(prof[lo:hi])); out = []
    for xa, xb in ((0, cut), (cut, len(prof))):
        sub = m[:, xa:xb]; ys, xs = np.where(sub)
        if len(xs) < 50: continue
        out += split_wide(im, [x0 + xa + int(xs.min()), y0 + int(ys.min()), x0 + xa + int(xs.max()) + 1, y0 + int(ys.max()) + 1, cid], max_w)
    return out

def slice_grid(im, cols, row_edges, thresh=100, min_area=150, pad=2):
    """row_edges: y boundaries of the grid rows (len = rows+1). cols: uniform column count, or one count per row."""
    cells = {}
    for b0 in components(im, thresh, 0, min_area):
      cy0 = (b0[1] + b0[3]) / 2; r0 = min(max(0, int(np.searchsorted(row_edges, cy0) - 1)), len(row_edges) - 2)
      nc0 = cols[r0] if isinstance(cols, (list, tuple)) else cols
      for b in split_wide(im, b0, 1.35 * im.width / nc0):
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        r = max(0, int(np.searchsorted(row_edges, cy) - 1)); r = min(r, len(row_edges) - 2)
        nc = cols[r] if isinstance(cols, (list, tuple)) else cols; cw = im.width / nc
        c = min(int(cx // cw), nc - 1)
        cells.setdefault((r, c), []).append(b)
    out = []
    for (r, c) in sorted(cells):
        b = pad_box(union(cells[(r, c)]), im, pad); out.append({"row": r, "col": c, "box": b[:4], "ids": b[4], "w": b[2] - b[0], "h": b[3] - b[1]})
    return out

def slice_free(im, thresh=100, dilate=1, min_area=250, pad=2, merges=(), splits=()):
    boxes = [pad_box(b, im, pad) for b in components(im, thresh, dilate, min_area)]
    boxes.sort(key=lambda b: ((b[1] + b[3]) / 2, b[0]))
    rows = []
    for b in boxes:  # group into visual rows by centre-y proximity
        cy = (b[1] + b[3]) / 2; h = b[3] - b[1]
        if rows and abs(cy - rows[-1]["cy"]) < max(h, rows[-1]["h"]) * 0.45:
            r = rows[-1]; r["boxes"].append(b); r["cy"] = (r["cy"] * (len(r["boxes"]) - 1) + cy) / len(r["boxes"]); r["h"] = max(r["h"], h)
        else: rows.append({"cy": cy, "h": h, "boxes": [b]})
    cells = []
    for r, row in enumerate(rows):
        for c, b in enumerate(sorted(row["boxes"], key=lambda b: b[0])):
            cells.append({"row": r, "col": c, "box": b[:4], "ids": b[4], "w": b[2] - b[0], "h": b[3] - b[1], "orig": len(cells)})
    for idx, y in splits:  # cut one component horizontally at sheet y (two stacked objects that touch)
        c = cells[idx]; x0, y0, x1, y1 = c["box"]; m = np.isin(LABELS[y0:y1, x0:x1], c["ids"])
        for part, (ya, yb) in enumerate([(y0, y), (y, y1)]):
            sub = m[ya - y0:yb - y0]; ys, xs = np.where(sub)
            box = [x0 + int(xs.min()), ya + int(ys.min()), x0 + int(xs.max()) + 1, ya + int(ys.max()) + 1]
            cell = {"row": c["row"], "col": c["col"], "box": box, "ids": c["ids"], "w": box[2] - box[0], "h": box[3] - box[1], "orig": idx if part == 0 else 100 + idx}
            if part == 0: cells[idx] = cell
            else: cells.append(cell)
    for group in merges:  # indices (in the order above) to merge into one cell
        keep = cells[group[0]]; u = union([cells[i]["box"] + [cells[i]["ids"]] for i in group]); keep["box"] = u[:4]; keep["ids"] = u[4]
        keep["w"] = keep["box"][2] - keep["box"][0]; keep["h"] = keep["box"][3] - keep["box"][1]
        for i in sorted(group[1:], reverse=True): cells[i] = None
    return [c for c in cells if c]

def write_cells(im, cells, out_dir, names, prefix):
    os.makedirs(out_dir, exist_ok=True); atlas = {}
    for f in os.listdir(out_dir):
        if f.endswith(".png"): os.remove(os.path.join(out_dir, f))
    for i, c in enumerate(cells):
        name = names.get(c.get("orig", i), f"{prefix}_{c.get('orig', i):02d}")
        crop = np.array(im.crop(c["box"])); x0, y0, x1, y1 = c["box"]
        mine = np.isin(LABELS[y0:y1, x0:x1], c["ids"]); crop[..., 3] = np.where(mine, crop[..., 3], 0)   # keep only this cell's own ink
        fn = f"{name}.png"; Image.fromarray(crop, "RGBA").save(os.path.join(out_dir, fn), optimize=True)
        # ground anchor: x = centre of the ink in the bottom `foot` rows (plinth / feet), y = bottom edge
        ink = crop[..., 3] > 100; foot = ink[max(0, ink.shape[0] - 16):]; xs = np.where(foot.any(axis=0))[0]
        ax = float((xs.min() + xs.max()) / 2) if len(xs) else c["w"] / 2
        atlas[name] = {"file": fn, "w": c["w"], "h": c["h"], "row": c["row"], "col": c["col"], "src": c["box"], "index": i, "anchor": [round(ax, 1), c["h"]]}
    json.dump(atlas, open(os.path.join(out_dir, "atlas.json"), "w"), indent=1)
    return atlas

def contact(im, cells, path, scale=0.75):
    sheet = Image.new("RGBA", im.size, (36, 36, 44, 255)); sheet.alpha_composite(im); d = ImageDraw.Draw(sheet)
    try: font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 26)
    except Exception: font = ImageFont.load_default()
    for i, c in enumerate(cells):
        x0, y0, x1, y1 = c["box"]; d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 220, 0, 255), width=2)
        d.rectangle([x0, y0, x0 + 40, y0 + 28], fill=(200, 0, 0, 230)); d.text((x0 + 3, y0), str(i), fill=(255, 255, 255, 255), font=font)
    sheet.resize((int(sheet.width * scale), int(sheet.height * scale)), Image.LANCZOS).save(path)

# ---- per-sheet configs (names are index -> name; indices come from the contact sheets) -----------------
BARKEEP = {
    0: "hip_smile", 1: "hands_folded", 2: "arms_wide", 3: "point_right", 4: "mug_hip",
    5: "two_mugs", 6: "belly_laugh", 7: "hands_hips", 8: "arms_crossed", 9: "worried",
    10: "point_left", 11: "wave", 12: "lean_in", 13: "finger_up", 14: "cheer_mug",
    15: "thinking", 16: "hand_heart", 17: "sword_ready", 18: "sword_raised", 19: "stop_hand",
}
ARM_POSES = ["rest", "raise", "thrust", "guard", "cocked", "slash", "hit", "stagger", "clash", "confused"]
ARMS = {i: f"red_{n}" for i, n in enumerate(ARM_POSES)} | {10 + i: f"blue_{n}" for i, n in enumerate(ARM_POSES)}
ARMS |= {20 + i: n for i, n in enumerate(["fx_spark", "fx_dust", "fx_exclaim", "fx_stars", "fx_swoosh"])}
TOWN = {
    0: "tavern",
    1: "forge",
    2: "arena_gate",
    3: "market_stall",
    4: "notice_board",
    5: "signpost",
    6: "sign_swords",
    7: "sign_mug",
    8: "banner_blue_lion",
    9: "banner_red_fleur",
    10: "pennants_vertical",
    11: "tents",
    12: "training_dummy",
    13: "weapon_rack",
    14: "cart",
    15: "horse",
    16: "crates_pile",
    17: "table_long",
    18: "bench",
    19: "stool",
    20: "barrel_large",
    21: "barrel_small",
    22: "crate_sack",
    23: "apple_basket",
    24: "candles",
    25: "lantern_wall",
    26: "lantern_post",
    27: "torch_brazier",
    28: "banner_post",
    29: "well",
    30: "fountain",
    31: "planter_purple",
    32: "flower_pot",
    33: "flower_box",
    34: "bush_flowers",
    35: "cypress_pot",
    36: "fence_wood",
    37: "rope_post",
    38: "bunting",
    39: "arch",
    40: "wall_ivy",
    41: "pillar_banner",
    42: "cobbles",
    43: "pillar_lamp",
    44: "wall_low",
    45: "grass_patch",
    46: "rocks_a",
    47: "dirt_small",
    48: "dirt_patch",
    49: "rocks_b",
    50: "rock_c",
    51: "standing_stone",
    52: "rubble",
    53: "palisade",
    54: "heraldic_bunting",
    55: "gate_wood",
}
TOWN_MERGES = ()   # e.g. ((3, 4),) to merge two components into one prop
# second arm sheet (steel swords, motion trails): 6 x 4 poses + 8 fx
ARMS2 = {0: "red_raise", 1: "red_ready", 2: "red_high", 3: "red_low", 4: "red_swing", 5: "red_windup", 6: "red_lunge", 7: "red_twirl", 8: "red_smash", 9: "red_crouch", 10: "red_rising", 11: "red_dizzy",
         12: "blue_raise", 13: "blue_ready", 14: "blue_high", 15: "blue_low", 16: "blue_swing", 17: "blue_windup", 18: "blue_lunge", 19: "blue_twirl", 20: "blue_smash", 21: "blue_crouch", 22: "blue_rising", 23: "blue_dizzy",
         24: "fx_burst_orange", 25: "fx_burst_blue", 26: "fx_spark_yellow", 27: "fx_dust2", 28: "fx_stars_ring", 29: "fx_arc_red", 30: "fx_arc_blue", 31: "fx_shield_blue"}
CROWD = {}   # spectators: single figures (rows 1-5) and packed groups (bottom row); named crowd_<i>
ARENA = {
    0: "gate",
    1: "grandstand",
    2: "royal_box",
    3: "palisade_shield",
    4: "pennant_string",
    5: "fence_banners_long",
    6: "banner_blue_post",
    7: "banner_red_post",
    8: "training_dummy",
    9: "rope_barrier",
    10: "shield_blue",
    11: "supplies",
    12: "shield_red",
    13: "banner_checker",
    14: "fence_banner_short",
    15: "signpost",
    16: "trumpet",
    17: "podium",
    18: "flags_pair",
    19: "heralds_box",
    20: "flags_red_cream",
    21: "scoreboard",
    22: "dirt_a",
    23: "dirt_b",
    24: "dirt_small",
    25: "rocks_small",
    26: "cobbles_a",
    27: "cobbles_b",
    28: "rocks_grass",
    29: "rocks_mossy",
    30: "rocks_c",
    31: "rocks_d",
    32: "brazier_bowl",
    33: "brazier_tall",
    34: "torch_post",
    35: "palisade",
    36: "wheel", 121: "trophy",
}
ARENA_MERGES = ((19, 16),)   # the left trumpet belongs to the heralds' box
ARENA_SPLITS = ((21, 527),)  # the scoreboard sits on top of the trophy statue: cut at sheet y = 527

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--contact", action="store_true"); a = ap.parse_args()
    im = load_rgba(os.path.join(RAW, "barkeep_sheet.png"), True)
    cells = slice_grid(im, 5, [0, 313, 627, 940, 1254]); write_cells(im, cells, os.path.join(ROOT, "assets", "sprites"), BARKEEP, "barkeep")
    print("barkeep:", len(cells));  a.contact and contact(im, cells, os.path.join(ROOT, "tools", "contact_barkeep.png"))
    im = load_rgba(os.path.join(RAW, "arms_sheet.png"), False)
    cells = slice_grid(im, 5, [0, 255, 505, 755, 985, 1125]); write_cells(im, cells, os.path.join(ROOT, "assets", "arms"), ARMS, "arm")
    print("arms:", len(cells));  a.contact and contact(im, cells, os.path.join(ROOT, "tools", "contact_arms.png"))
    im = load_rgba(os.path.join(RAW, "arms2_sheet.png"), False)
    cells = slice_grid(im, [6, 6, 6, 6, 8], [0, 199, 372, 568, 744, 843]); write_cells(im, cells, os.path.join(ROOT, "assets", "arms2"), ARMS2, "arm2")
    print("arms2:", len(cells));  a.contact and contact(im, cells, os.path.join(ROOT, "tools", "contact_arms2.png"), scale=1.3)
    im = load_rgba(os.path.join(RAW, "town_sheet.png"), False)
    cells = slice_free(im, merges=TOWN_MERGES); write_cells(im, cells, os.path.join(ROOT, "assets", "town"), TOWN, "town")
    print("town:", len(cells));  a.contact and contact(im, cells, os.path.join(ROOT, "tools", "contact_town.png"), scale=1.0)
    im = load_rgba(os.path.join(RAW, "crowd_sheet.png"), False)
    cells = slice_free(im, dilate=2, min_area=600); write_cells(im, cells, os.path.join(ROOT, "assets", "crowd"), CROWD, "crowd")
    print("crowd:", len(cells));  a.contact and contact(im, cells, os.path.join(ROOT, "tools", "contact_crowd.png"), scale=1.0)
    im = load_rgba(os.path.join(RAW, "arena_sheet.png"), False)
    cells = slice_free(im, merges=ARENA_MERGES, splits=ARENA_SPLITS); write_cells(im, cells, os.path.join(ROOT, "assets", "arena"), ARENA, "arena")
    print("arena:", len(cells));  a.contact and contact(im, cells, os.path.join(ROOT, "tools", "contact_arena.png"), scale=1.3)

if __name__ == "__main__":
    main()

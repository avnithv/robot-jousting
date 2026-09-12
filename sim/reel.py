"""Concatenate rendered clips into one labelled reel: python reel.py out/reel_moves.mp4 tuned_ATTACK_HIGH tuned_FEINT_HIGH ..."""
import sys, imageio, numpy as np
from PIL import Image, ImageDraw, ImageFont
out, names = sys.argv[1], sys.argv[2:]; frames = []
font = ImageFont.load_default(size=28) if hasattr(ImageFont, "load_default") else None
for n in names:
    rd = imageio.get_reader(f"out/{n}.mp4"); label = n.replace("tuned_", "").replace("pair_", "").replace("_vs_", "  vs  ")
    for i, f in enumerate(rd):
        im = Image.fromarray(f); ImageDraw.Draw(im).text((20, 16), label, fill=(255, 255, 255), font=font); frames.append(np.asarray(im))
    frames += [frames[-1]] * 15   # short hold between clips
imageio.mimwrite(out, frames, fps=30, codec="libx264", quality=8, macro_block_size=1); print("wrote", out, len(frames), "frames")

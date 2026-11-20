#!/usr/bin/env python3
"""Lossless PNG size reduction for app/site (maps' lightmaps, weapon skin textures).

Re-encodes every PNG under aim-maps/ and aim-viewmodel/ with Pillow's optimiser and keeps
the result only when ALL of these hold:
  - it is smaller than the original,
  - mode and size are identical,
  - every pixel is identical (compared after decoding both),
  - the original has no colour-management chunk (gAMA, iCCP, sRGB, cHRM, cICP) and is not
    interlaced, so dropping the other ancillary chunks cannot change how a browser shows it.

Dry run by default (prints the saving, writes nothing). Pass --write to replace files.
Needs Pillow:  pip install pillow

  python tools/optimize-png.py [--write] [site dir, default app/site]

The files are tracked in git, so --write makes a large binary diff: run it once, on a
release branch, not casually.
"""
import io
import os
import struct
import sys

from PIL import Image, ImageChops

COLOUR_CHUNKS = {b'gAMA', b'iCCP', b'sRGB', b'cHRM', b'cICP'}


def chunks(path):
    with open(path, 'rb') as f:
        data = f.read()
    pos, out = 8, []
    while pos + 8 <= len(data):
        n = struct.unpack('>I', data[pos:pos + 4])[0]
        out.append(data[pos + 4:pos + 8])
        pos += 12 + n
    return data, out


def same_pixels(a, b):
    if a.mode != b.mode or a.size != b.size:
        return False
    if a.mode in ('P', 'PA'):
        a, b = a.convert('RGBA'), b.convert('RGBA')
    return ImageChops.difference(a, b).getbbox() is None if a.mode in ('L', 'RGB', 'RGBA') else a.tobytes() == b.tobytes()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    write = '--write' in sys.argv
    root = args[0] if args else os.path.join(os.path.dirname(__file__), '..', 'app', 'site')
    before = after = kept = skipped = 0
    for sub in ('aim-maps', 'aim-viewmodel'):
        d = os.path.join(root, sub)
        for name in sorted(os.listdir(d)):
            if not name.lower().endswith('.png'):
                continue
            p = os.path.join(d, name)
            data, cs = chunks(p)
            before += len(data)
            if COLOUR_CHUNKS & set(cs):
                after += len(data); skipped += 1
                continue
            im = Image.open(io.BytesIO(data)); im.load()
            if im.info.get('interlace'):
                after += len(data); skipped += 1
                continue
            buf = io.BytesIO()
            im.save(buf, 'PNG', optimize=True)
            new = buf.getvalue()
            ok = len(new) < len(data)
            if ok:
                chk = Image.open(io.BytesIO(new)); chk.load()
                ok = same_pixels(im, chk)
            if ok:
                after += len(new); kept += 1
                if write:
                    tmp = p + '.tmp'
                    with open(tmp, 'wb') as f:
                        f.write(new)
                    os.replace(tmp, p)
            else:
                after += len(data); skipped += 1
    print('png files re-encoded %d, left alone %d' % (kept, skipped))
    print('before %.1f MB, after %.1f MB, saved %.1f MB (%.1f%%)%s' % (
        before / 1048576, after / 1048576, (before - after) / 1048576,
        100.0 * (before - after) / max(before, 1), '' if write else '  [dry run]'))


if __name__ == '__main__':
    main()

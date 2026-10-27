#!/usr/bin/env python3
# to_webp.py — безпотерный перегон PNG из design/shots в WebP (lossless).
# PNG-исходники удаляются после успешной конвертации.
# Запуск из корня репо:  python3 scripts/shots/to_webp.py
import glob
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('Нужен Pillow: pip install pillow')

DST = os.environ.get('OUT', 'design/shots')
total_src = total_dst = 0
for p in sorted(glob.glob(os.path.join(DST, '*.png'))):
    img = Image.open(p).convert('RGBA')
    out = p[:-4] + '.webp'
    img.save(out, 'WEBP', lossless=True, method=6)
    s, d = os.path.getsize(p), os.path.getsize(out)
    total_src += s
    total_dst += d
    os.remove(p)
    print(f'  {os.path.basename(p)} ({s//1024}K) -> {os.path.basename(out)} ({d//1024}K)')

if total_src:
    print(f'\nИТОГ: {total_src//1024}K PNG -> {total_dst//1024}K lossless WebP '
          f'({total_dst*100//total_src}%)')
else:
    print('PNG в', DST, 'не найдены — нечего конвертировать')

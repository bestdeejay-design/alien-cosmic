#!/usr/bin/env python3
"""Regenerate the social card from the visual language of the landing hero.

Run from the repository root: python3 scripts/shots/og_image.py
Requires Pillow (pip install pillow). Output: assets/og-image.png, 1200×630.
"""
from pathlib import Path
import math
import random
import struct

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError as exc:
    raise SystemExit('Нужен Pillow: pip install pillow') from exc

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'assets'
OUTPUT = ASSETS / 'og-image.png'
W, H, SCALE = 1200, 630, 2
CW, CH = W * SCALE, H * SCALE


def s(value: float) -> int:
    return round(value * SCALE)


def pt(point):
    return (s(point[0]), s(point[1]))


def box(x1, y1, x2, y2):
    return (s(x1), s(y1), s(x2), s(y2))


def font_file(bold=False):
    names = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
        '/Library/Fonts/Arial Bold.ttf' if bold else '/Library/Fonts/Arial.ttf',
    ]
    for name in names:
        if Path(name).is_file():
            return name
    return None


FONT_REGULAR = font_file()
FONT_BOLD = font_file(True)


def fnt(size, bold=False):
    path = FONT_BOLD if bold else FONT_REGULAR
    if path:
        return ImageFont.truetype(path, s(size))
    try:
        return ImageFont.load_default(size=s(size))
    except TypeError:  # Pillow до scalable default font
        return ImageFont.load_default()


def tracked(draw, xy, text, font, fill, spacing=2):
    x, y = xy
    for char in text:
        draw.text((s(x), s(y)), char, font=font, fill=fill, anchor='lt')
        x += draw.textlength(char, font=font) / SCALE + spacing


def lerp(a, b, t):
    return round(a + (b - a) * t)


def make_planet(center, radius):
    diameter = s(radius * 2)
    cx = cy = diameter / 2
    pixels = bytearray(diameter * diameter * 4)
    mask_pixels = bytearray(diameter * diameter)
    light_x, light_y = diameter * .28, diameter * .23
    max_light = math.hypot(diameter * .85, diameter * .84)
    base_shadow = (7, 22, 29)
    base_light = (66, 120, 117)
    for y in range(diameter):
        ny = (y - cy) / cy
        for x in range(diameter):
            nx = (x - cx) / cx
            d2 = nx * nx + ny * ny
            if d2 > 1:
                continue
            idx = (y * diameter + x)
            distance = math.hypot(x - light_x, y - light_y) / max_light
            illumination = max(0.0, min(1.0, 1.05 - distance))
            limb = math.sqrt(max(0.0, 1.0 - d2))
            shade = max(0.0, min(1.0, illumination * .78 + limb * .2))
            # A soft dusk line gives the world a readable lit/dark hemisphere.
            dusk = max(0.0, min(1.0, (nx + ny * .18 + .62) * 1.2))
            shade *= .54 + dusk * .46
            for channel, (lo, hi) in enumerate(zip(base_shadow, base_light)):
                pixels[idx * 4 + channel] = lerp(lo, hi, shade)
            pixels[idx * 4 + 3] = 255
            mask_pixels[idx] = 255
    planet = Image.frombytes('RGBA', (diameter, diameter), bytes(pixels))
    mask = Image.frombytes('L', (diameter, diameter), bytes(mask_pixels))

    # Subtle mineral continents and fracture lines, clipped to the sphere.
    surface = Image.new('RGBA', (diameter, diameter), (0, 0, 0, 0))
    d = ImageDraw.Draw(surface)
    c = diameter / 2
    def poly(points, color):
        d.polygon([(s(x + radius), s(y + radius)) for x, y in points], fill=color)
    def local(x, y):
        return (s(radius + x), s(radius + y))
    # Local coordinates make the land silhouettes match the hero illustration.
    continent_color = (36, 94, 104, 178)
    poly([(-128, -121), (-72, -143), (-20, -119), (7, -77), (-14, -43), (-71, -48), (-106, -14), (-147, -39), (-151, -82)], continent_color)
    poly([(44, -103), (89, -121), (140, -88), (132, -40), (99, -21), (76, 19), (42, 1), (25, -42)], (31, 83, 91, 175))
    poly([(-74, 26), (-25, 5), (24, 20), (59, 64), (39, 104), (7, 128), (-30, 106), (-56, 70), (-93, 63)], (31, 84, 91, 160))
    poly([(107, 70), (145, 45), (184, 60), (187, 102), (155, 123), (122, 111)], (34, 89, 97, 160))
    # Fine ridges and the amber landing beacon.
    ridge = (197, 248, 233, 62)
    d.line([local(-102,-101), local(-46,-73), local(-18,-24)], fill=ridge, width=s(1))
    d.line([local(35,125), local(91,108), local(140,122)], fill=(126, 217, 231, 88), width=s(1))
    beacon = (s(radius - 83), s(radius - 62))
    d.ellipse((beacon[0]-s(13), beacon[1]-s(13), beacon[0]+s(13), beacon[1]+s(13)), outline=(243,197,121,140), width=s(1))
    d.ellipse((beacon[0]-s(4), beacon[1]-s(4), beacon[0]+s(4), beacon[1]+s(4)), fill=(243,197,121,235))
    d.line((beacon[0], beacon[1]-s(21), beacon[0], beacon[1]+s(21)), fill=(243,197,121,145), width=s(1))
    d.line((beacon[0]-s(21), beacon[1], beacon[0]+s(21), beacon[1]), fill=(243,197,121,145), width=s(1))
    surface.putalpha(ImageChops_multiply(surface.getchannel('A'), mask))
    planet.alpha_composite(surface)

    # A restrained crescent highlight and a dark edge keep the silhouette crisp.
    edge = Image.new('RGBA', (diameter, diameter), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.ellipse((1, 1, diameter-2, diameter-2), outline=(197,255,241,104), width=s(1))
    ed.arc((s(16), s(13), diameter-s(10), diameter-s(16)), start=198, end=287, fill=(197,255,241,110), width=s(3))
    edge.putalpha(ImageChops_multiply(edge.getchannel('A'), mask))
    planet.alpha_composite(edge)

    layer = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    layer.alpha_composite(planet, (s(center[0] - radius), s(center[1] - radius)))
    return layer


def ImageChops_multiply(a, b):
    # Kept as a tiny helper to make this generator's only non-drawing work explicit.
    from PIL import ImageChops
    return ImageChops.multiply(a, b)


def draw_ship_human(draw, x, y):
    hull = [(x-43, y), (x+19, y-20), (x+42, y), (x+18, y+20)]
    draw.polygon([pt(p) for p in hull], fill=(72, 145, 143, 255), outline=(197,255,241,235))
    draw.polygon([pt((x-13,y-11)), pt((x+8,y)), pt((x-13,y+11)), pt((x-6,y))], fill=(7,24,31,255))
    draw.line([pt((x-37,y)), pt((x-57,y))], fill=(118,227,215,255), width=s(3))
    draw.line([pt((x+11,y-17)), pt((x+22,y-31)), pt((x+27,y-7))], fill=(197,255,241,220), width=s(2))
    draw.line([pt((x+11,y+17)), pt((x+22,y+31)), pt((x+27,y+7))], fill=(197,255,241,220), width=s(2))
    draw.ellipse(box(x-2,y-3,x+4,y+3), fill=(243,197,121,255))


def draw_ship_kharid(draw, x, y):
    draw.polygon([pt((x-40,y)), pt((x-20,y-19)), pt((x+22,y-13)), pt((x+42,y)), pt((x+19,y+14)), pt((x-21,y+19))], fill=(113,57,67,255), outline=(255,208,181,235))
    draw.polygon([pt((x-4,y-10)), pt((x+29,y)), pt((x-4,y+10)), pt((x+9,y))], fill=(42,22,31,255))
    for a, b in [((x-25,y-9),(x-43,y-26)), ((x-23,y+9),(x-43,y+26)), ((x+5,y-14),(x+2,y-34)), ((x+6,y+14),(x+2,y+34))]:
        draw.line([pt(a),pt(b)], fill=(255,128,110,245), width=s(3))
    draw.ellipse(box(x+8,y-3,x+14,y+3), fill=(243,197,121,255))


def draw_crystals(draw, x, y):
    draw.polygon([pt((x,y)), pt((x+18,y-47)), pt((x+34,y-6)), pt((x+27,y+29)), pt((x+4,y+31)), pt((x-8,y+10))], fill=(126,217,231,224), outline=(197,255,241,235))
    draw.polygon([pt((x+18,y-47)), pt((x+20,y-9)), pt((x+27,y+29)), pt((x+34,y-6))], fill=(197,255,241,155))
    draw.polygon([pt((x-12,y+12)), pt((x-10,y-17)), pt((x+5,y-3)), pt((x+7,y+21)), pt((x-4,y+29))], fill=(118,227,215,210), outline=(197,255,241,185))
    draw.polygon([pt((x+40,y+13)), pt((x+50,y-15)), pt((x+59,y+12)), pt((x+53,y+32)), pt((x+41,y+29))], fill=(243,197,121,210), outline=(255,225,168,210))
    draw.line([pt((x-20,y+37)), pt((x+69,y+37))], fill=(118,227,215,95), width=s(1))


def make_image():
    # Deep-blue vertical falloff with a teal nebula growing behind the planet.
    image = Image.new('RGB', (CW, CH))
    pixels = image.load()
    top, bottom = (12, 32, 40), (5, 15, 20)
    for y in range(CH):
        t = y / max(1, CH - 1)
        color = tuple(lerp(top[i], bottom[i], t) for i in range(3))
        ImageDraw.Draw(image).line((0, y, CW, y), fill=color)

    glow = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse(box(620, 15, 1260, 665), fill=(36,94,104,70))
    gd.ellipse(box(765, 80, 1150, 590), fill=(20,65,71,72))
    glow = glow.filter(ImageFilter.GaussianBlur(s(68)))
    image = Image.alpha_composite(image.convert('RGBA'), glow)
    d = ImageDraw.Draw(image, 'RGBA')

    # A quiet instrument grid and deterministic star field.
    for x in range(24, 500, 44):
        d.line((s(x), 0, s(x), CH), fill=(118,227,215,9), width=1)
    for y in range(484, 630, 38):
        d.line((0, s(y), CW, s(y)), fill=(118,227,215,12), width=1)
    rng = random.Random(6404)
    for _ in range(118):
        x, y = rng.randint(24, 1182), rng.randint(24, 608)
        radius = rng.choice([.45, .6, .75, 1.0])
        color = rng.choice([(197,255,241,132),(118,227,215,110),(243,197,121,105)])
        d.ellipse(box(x-radius, y-radius, x+radius, y+radius), fill=color)

    # Thin orbital tracks behind the planet.
    ring = Image.new('RGBA', (s(760), s(420)), (0,0,0,0))
    rd = ImageDraw.Draw(ring, 'RGBA')
    rd.ellipse(box(8, 96, 752, 326), outline=(118,227,215,112), width=s(1))
    rd.ellipse(box(38, 120, 720, 302), outline=(243,197,121,85), width=s(1))
    rd.ellipse(box(85, 142, 670, 282), outline=(118,227,215,53), width=s(1))
    ring = ring.rotate(23, resample=Image.Resampling.BICUBIC, expand=False)
    image.alpha_composite(ring, (s(528), s(102)))

    # Planet glow, sphere, and etched orbital rings — same light-on-dark language as the hero.
    halo = Image.new('RGBA', (CW, CH), (0,0,0,0))
    hd = ImageDraw.Draw(halo)
    hd.ellipse(box(682, 77, 1188, 583), fill=(118,227,215,42))
    halo = halo.filter(ImageFilter.GaussianBlur(s(42)))
    image = Image.alpha_composite(image, halo)
    image = Image.alpha_composite(image, make_planet((931, 335), 218))
    d = ImageDraw.Draw(image, 'RGBA')
    d.ellipse(box(713,117,1149,553), outline=(197,255,241,52), width=s(1))
    d.arc(box(726,125,1138,545), 195, 282, fill=(197,255,241,138), width=s(2))
    d.arc(box(734,132,1130,538), 20, 105, fill=(255,128,110,130), width=s(2))
    d.line([pt((829,175)), pt((858,159)), pt((895,151))], fill=(197,255,241,148), width=s(2))
    d.line([pt((1032,492)), pt((1065,471)), pt((1087,440))], fill=(255,128,110,176), width=s(2))

    # A small moon and two faction-distinct scouting silhouettes.
    d.ellipse(box(1072,90,1148,166), fill=(18,43,51,255), outline=(118,227,215,110), width=s(1))
    d.arc(box(1077,95,1144,162), 195, 312, fill=(197,255,241,86), width=s(2))
    draw_ship_human(d, 663, 218)
    draw_ship_kharid(d, 1117, 463)
    draw_crystals(d, 712, 526)
    d.line([pt((694,204)),pt((747,184)),pt((780,175))], fill=(118,227,215,90), width=s(1))
    d.line([pt((1092,484)),pt((1065,501)),pt((1030,511))], fill=(255,128,110,95), width=s(1))

    # Brand and a short, language-neutral campaign line.
    tracked(d, (82, 150), 'ALIEN', fnt(72, True), (233,248,242,255), spacing=1.5)
    tracked(d, (82, 232), 'COSMIC', fnt(72, True), (118,227,215,255), spacing=1.5)
    d.line((s(86), s(268), s(346), s(268)), fill=(118,227,215,190), width=s(1))
    d.ellipse(box(355,265,362,272), fill=(243,197,121,245))
    tracked(d, (88, 296), 'REAL-TIME STRATEGY', fnt(12, True), (145,173,174,255), spacing=2.4)
    d.text((s(86), s(342)), 'The frontier is a battlefield.', font=fnt(23, True), fill=(233,248,242,255), anchor='lt')
    d.text((s(88), s(383)), 'Choose a side. Hold the line.', font=fnt(15), fill=(145,173,174,255), anchor='lt')
    tracked(d, (88, 526), 'TWO SIDES · ONE FRONTIER', fnt(10, True), (118,227,215,245), spacing=1.7)

    # Corner registration marks and a quiet production code.
    d.line((s(48),s(48),s(78),s(48)), fill=(118,227,215,170), width=s(2))
    d.line((s(48),s(48),s(48),s(78)), fill=(118,227,215,170), width=s(2))
    d.line((s(1152),s(582),s(1122),s(582)), fill=(118,227,215,170), width=s(2))
    d.line((s(1152),s(582),s(1152),s(552)), fill=(118,227,215,170), width=s(2))
    d.text((s(1118),s(586)), 'AC // 64.04', font=fnt(8), fill=(145,173,174,200), anchor='rt')
    return image.convert('RGB').resize((W, H), Image.Resampling.LANCZOS)


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    image = make_image()
    image.save(OUTPUT, format='PNG', optimize=True)
    with OUTPUT.open('rb') as stream:
        data = stream.read(24)
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit('Не удалось создать корректный PNG.')
    width, height = struct.unpack('>II', data[16:24])
    if (width, height) != (W, H):
        raise SystemExit(f'Ожидался PNG 1200×630, получено {width}×{height}.')
    print(f'Создано {OUTPUT.relative_to(ROOT)} · {width}×{height} · {OUTPUT.stat().st_size:,} байт')


if __name__ == '__main__':
    main()

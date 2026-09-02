#!/usr/bin/env python3
"""生成 Runify 打包资源（应用图标 / 托盘图标 / DMG 安装器背景）。

产物（均写入 resources/）：
  icon.png       1024x1024，应用图标（Linux / 兜底）
  icon.icns      macOS 应用图标（由 iconset 经 iconutil 打包）
  icon.ico       Windows 应用图标（多尺寸 ico）
  tray.png       32x32 托盘 idle 图标
  tray-syncing.png  32x32 托盘 running/syncing 图标
  dmg-background.png     660x400 DMG 安装器背景（1x）
  dmg-background@2x.png  1320x800 同名 2x，供 retina 屏选用

设计：深色渐变底 + 绿色光晕 + 白色播放三角 + 三条速度线（run 的意象），
轮廓用超椭圆（squircle）裁切以贴近 macOS 图标外形。
DMG 背景的两个虚线圈位置需与 electronup.config.ts 里 dmg.contents 的
x/y 严格一致（那些坐标是图标中心点）。

用法：python3 scripts/gen-icon.py
依赖：Pillow（pip install pillow）；macOS 需要系统自带的 iconutil。
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'resources'
SS = 2                      # 超采样倍数：先在 2x 画布绘制，再缩小抗锯齿
BASE = 1024
SIZE = BASE * SS

BG_TOP = (0x2B, 0x2B, 0x30)
BG_BOTTOM = (0x13, 0x13, 0x16)
ACCENT = (0x34, 0xC7, 0x59)
FG = (0xFF, 0xFF, 0xFF)
TRAY_IDLE = (0x8A, 0x8F, 0x98)

# DMG 安装器背景尺寸：必须与 electronup.config.ts 的 dmg.window 一致
DMG_W, DMG_H = 660, 400
# 两个放置区的中心点：必须与 dmg.contents 的 x/y 一致
DMG_APP_XY = (180, 190)
DMG_APPS_XY = (480, 190)
DMG_SLOT_R = 58

# 中文字体候选（DMG 提示文案需要 CJK 字形）
CJK_FONTS = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
]


def load_cjk_font(size: int) -> ImageFont.FreeTypeFont:
    for p in CJK_FONTS:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    print('  ! 未找到中文字体，DMG 文案将退化为默认字体（可能显示为方块）')
    return ImageFont.load_default()


def squircle_mask(size: int, n: float = 4.6, blur: float = 2.5) -> Image.Image:
    """超椭圆轮廓：|u|^n + |v|^n <= 1。小图计算后放大，边缘自然抗锯齿。"""
    n_small = 256
    m = Image.new('L', (n_small, n_small), 0)
    px = m.load()
    for y in range(n_small):
        v = (y + 0.5) / n_small * 2 - 1
        for x in range(n_small):
            u = (x + 0.5) / n_small * 2 - 1
            if abs(u) ** n + abs(v) ** n <= 1:
                px[x, y] = 255
    m = m.resize((size, size), Image.BICUBIC)
    if blur:
        from PIL import ImageFilter
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return m


def vertical_gradient(size: int, c1: tuple[int, int, int], c2: tuple[int, int, int]) -> Image.Image:
    strip = Image.new('RGB', (1, 256))
    px = strip.load()
    for i in range(256):
        t = i / 255
        px[0, i] = tuple(int(c1[k] + (c2[k] - c1[k]) * t) for k in range(3))
    return strip.resize((size, size), Image.BICUBIC)


def radial_glow(size: int, color: tuple[int, int, int], strength: float = 0.6,
                cx: float = 0.42, cy: float = 0.36, r: float = 0.62) -> Image.Image:
    n = 256
    img = Image.new('RGBA', (n, n))
    px = img.load()
    for y in range(n):
        dy = (y + 0.5) / n - cy
        for x in range(n):
            dx = (x + 0.5) / n - cx
            d = (dx * dx + dy * dy) ** 0.5
            a = 0.0 if d >= r else strength * (1 - d / r) ** 2
            px[x, y] = (*color, int(a * 255))
    return img.resize((size, size), Image.BICUBIC)


def draw_foreground(size: int) -> Image.Image:
    s = size
    layer = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # 播放三角（略偏左，尖端朝右）
    d.polygon(
        [(0.19 * s, 0.28 * s), (0.19 * s, 0.72 * s), (0.55 * s, 0.50 * s)],
        fill=(*FG, 255),
    )

    # 三条速度线（长度递减，表达「跑起来」）
    x0, thick = 0.62 * s, 0.062 * s
    for i, (length, cy) in enumerate([
        (0.19, 0.40),
        (0.13, 0.50),
        (0.08, 0.60),
    ]):
        x1 = x0 + length * s
        top = cy * s - thick / 2
        bot = cy * s + thick / 2
        radius = thick / 2
        d.rounded_rectangle(
            [x0, top, x1, bot],
            radius=radius,
            fill=(*ACCENT, 255 - i * 18),
        )
    return layer


def build(size: int = SIZE) -> Image.Image:
    bg = vertical_gradient(size, BG_TOP, BG_BOTTOM).convert('RGBA')
    glow = radial_glow(size, ACCENT)
    art = Image.alpha_composite(bg, glow)
    art = Image.alpha_composite(art, draw_foreground(size))
    art = art.resize((size // SS, size // SS), Image.LANCZOS)

    mask = squircle_mask(art.width)
    out = Image.new('RGBA', art.size, (0, 0, 0, 0))
    out.paste(art, (0, 0), mask)
    return out


def draw_tray(size: int = 32, color: tuple[int, int, int] = ACCENT) -> Image.Image:
    """32x32 托盘图标：向右三角，透明底。"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = 5
    d.polygon(
        [(pad, pad), (pad, size - pad), (size - pad, size // 2)],
        fill=(*color, 255),
    )
    return img


def dashed_ellipse(d: ImageDraw.ImageDraw, box: list[float], fill: tuple[int, int, int, int],
                   width: int = 2, steps: int = 64) -> None:
    """画虚线椭圆：PIL 没有 dash 参数，这里逐段画短弧实现。"""
    for i in range(0, steps, 2):
        d.arc(box, 360 * i / steps, 360 * (i + 1) / steps, fill=fill, width=width)


def dmg_background(scale: int = 1) -> Image.Image:
    """DMG 安装器背景：深色底 + 两个虚线放置区 + 中间箭头 + 底部提示文案。"""
    w, h = DMG_W * scale, DMG_H * scale
    # 底色渐变（垂直）
    strip = Image.new('RGB', (1, 256))
    px = strip.load()
    for i in range(256):
        t = i / 255
        px[0, i] = tuple(int(BG_TOP[k] + (BG_BOTTOM[k] - BG_TOP[k]) * t) for k in range(3))
    img = strip.resize((w, h), Image.BICUBIC).convert('RGBA')

    # 绿色光晕（居中偏上，拉成椭圆以贴合横向画布）
    glow = radial_glow(512, ACCENT, strength=0.42, cx=0.5, cy=0.42, r=0.72)
    img = Image.alpha_composite(img, glow.resize((w, h), Image.BICUBIC))

    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # 两个虚线放置区
    for (cx, cy) in (DMG_APP_XY, DMG_APPS_XY):
        x, y = cx * scale, cy * scale
        r = DMG_SLOT_R * scale
        dashed_ellipse(d, [x - r, y - r, x + r, y + r], (*ACCENT, 90), width=max(2, 2 * scale))

    # 中间箭头（app → Applications）
    ax0, ax1 = 262 * scale, 398 * scale
    ay = 190 * scale
    thick = max(2, 3 * scale)
    d.line([(ax0, ay), (ax1 - 12 * scale, ay)], fill=(*ACCENT, 210), width=thick)
    head = 13 * scale
    d.polygon(
        [(ax1 - head, ay - head * 0.78), (ax1 - head, ay + head * 0.78), (ax1, ay)],
        fill=(*ACCENT, 210),
    )

    # 底部提示文案
    font = load_cjk_font(int(17 * scale))
    tip = '将 Runify 拖入右侧 Applications 完成安装'
    box = d.textbbox((0, 0), tip, font=font)
    d.text(
        ((w - (box[2] - box[0])) / 2, 318 * scale),
        tip,
        font=font,
        fill=(0xE8, 0xE8, 0xEA, 200),
    )

    return Image.alpha_composite(img, layer)


def write_icns(icon: Image.Image, dest: Path) -> bool:
    iconutil = shutil.which('iconutil')
    if not iconutil:
        print('  ! 未找到 iconutil，跳过 icns（仅 macOS 可用）')
        return False
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / 'icon.iconset'
        iconset.mkdir()
        # (输出名, 实际像素)
        specs = [
            ('icon_16x16.png', 16),
            ('icon_16x16@2x.png', 32),
            ('icon_32x32.png', 32),
            ('icon_32x32@2x.png', 64),
            ('icon_128x128.png', 128),
            ('icon_128x128@2x.png', 256),
            ('icon_256x256.png', 256),
            ('icon_256x256@2x.png', 512),
            ('icon_512x512.png', 512),
            ('icon_512x512@2x.png', 1024),
        ]
        for name, px in specs:
            icon.resize((px, px), Image.LANCZOS).save(iconset / name, 'PNG')
        subprocess.run(
            [iconutil, '-c', 'icns', str(iconset), '-o', str(dest)],
            check=True,
        )
    return True


def write_ico(icon: Image.Image, dest: Path) -> None:
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon.save(dest, 'ICO', sizes=sizes)


def main() -> int:
    try:
        RES.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass  # 目录已存在
    icon = build()
    png = RES / 'icon.png'
    icon.save(png, 'PNG', optimize=True)

    write_ico(icon, RES / 'icon.ico')
    icns_ok = write_icns(icon, RES / 'icon.icns')

    print(f'  ✓ {png.relative_to(ROOT)} ({icon.width}x{icon.height})')
    print(f'  ✓ {RES / "icon.ico"}')
    if icns_ok:
        print(f'  ✓ {RES / "icon.icns"}')

    draw_tray(32, TRAY_IDLE).save(RES / 'tray.png', 'PNG', optimize=True)
    draw_tray(32, ACCENT).save(RES / 'tray-syncing.png', 'PNG', optimize=True)
    print(f'  ✓ {RES / "tray.png"} (idle)')
    print(f'  ✓ {RES / "tray-syncing.png"} (syncing)')

    dmg_background(1).save(RES / 'dmg-background.png', 'PNG', optimize=True)
    dmg_background(2).save(RES / 'dmg-background@2x.png', 'PNG', optimize=True)
    print(f'  ✓ {RES / "dmg-background.png"} ({DMG_W}x{DMG_H})')
    print(f'  ✓ {RES / "dmg-background@2x.png"} ({DMG_W * 2}x{DMG_H * 2})')
    return 0


if __name__ == '__main__':
    sys.exit(main())

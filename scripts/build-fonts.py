#!/usr/bin/env python3
"""Builds the superscripts used for exponents (10⁶⁰, 10⁻⁵, sin⁻¹) into the app's fonts.

The web subsets and the IBM Plex files have ¹²³ but not ⁰⁴⁵⁶⁷⁸⁹⁻, so an exponent mixed two faces and
spaced out like 10¹ ⁶. This draws one tight set from Geist Mono: digits from its superscripts, ⁺ and ⁻
scaled from its plus and minus. It writes src/assets/Superscripts.woff2 for the web, whose font stacks
list it first. In a checkout with the phone app it also adds the glyphs to mobile/assets/fonts/*.ttf, because
React Native has no font stacks.

Needs fonttools and brotli, and the `geist` npm package unpacked: build-fonts.py <geist>/dist/fonts
"""
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

DIGITS = {0x2070: 'zero', 0xB9: 'one', 0xB2: 'two', 0xB3: 'three', 0x2074: 'four', 0x2075: 'five', 0x2076: 'six', 0x2077: 'seven', 0x2078: 'eight', 0x2079: 'nine'}
SIGNS = {0x207A: 0x2B, 0x207B: 0x2212}  # ⁺ from +, ⁻ from −
SIDE = 24  # Space each side of a glyph, so an exponent reads as one number.
SIGN_SCALE = 0.6


def recording(font, name):
    pen = DecomposingRecordingPen(font.getGlyphSet())
    font.getGlyphSet()[name].draw(pen)
    return pen


def drawn(rec, transform):
    pen = TTGlyphPen(None)
    rec.replay(TransformPen(pen, transform))
    return pen.glyph()


def tight(rec, transform):
    """The outline moved to start at SIDE, and the advance that fits it."""
    glyph = drawn(rec, transform)
    glyph.recalcBounds(None)
    shift = SIDE - glyph.xMin
    width = glyph.xMax - glyph.xMin + 2 * SIDE
    a, b, c, d, e, f = transform
    glyph = drawn(rec, (a, b, c, d, e + shift, f))
    glyph.recalcBounds(None)
    return glyph, width


def supers(donor):
    """{codepoint: (glyph, advance)} from a Geist Mono weight."""
    cmap = donor.getBestCmap()
    out = {cp: tight(recording(donor, cmap[cp]), (1, 0, 0, 1, 0, 0)) for cp in DIGITS}
    ref = drawn(recording(donor, cmap[0x2074]), (1, 0, 0, 1, 0, 0))
    ref.recalcBounds(None)
    middle = (ref.yMin + ref.yMax) / 2
    for cp, base in SIGNS.items():
        rec = recording(donor, cmap[base])
        g = drawn(rec, (SIGN_SCALE, 0, 0, SIGN_SCALE, 0, 0))
        g.recalcBounds(None)
        out[cp] = tight(rec, (SIGN_SCALE, 0, 0, SIGN_SCALE, 0, middle - (g.yMin + g.yMax) / 2))
    return out


def add_to(font, glyphs):
    """Maps the superscript codepoints in a TrueType font to these glyphs, replacing any it had."""
    order = font.getGlyphOrder()
    for cp, (glyph, width) in glyphs.items():
        name = f'exp{cp:04X}'
        if name not in order:
            order.append(name)
        font['glyf'][name] = glyph
        font['hmtx'][name] = (width, glyph.xMin)
        for table in font['cmap'].tables:
            if table.isUnicode():
                table.cmap[cp] = name
    font.setGlyphOrder(order)
    font['maxp'].numGlyphs = len(order)


def standalone(glyphs):
    """A font with nothing but the superscripts, for the web's font stacks."""
    order = ['.notdef'] + [f'exp{cp:04X}' for cp in glyphs]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({cp: f'exp{cp:04X}' for cp in glyphs})
    blank = TTGlyphPen(None).glyph()
    fb.setupGlyf({'.notdef': blank, **{f'exp{cp:04X}': g for cp, (g, _) in glyphs.items()}})
    metrics = {'.notdef': (600, 0)}
    for cp, (g, w) in glyphs.items():
        metrics[f'exp{cp:04X}'] = (w, g.xMin)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=1005, descent=-295)
    fb.setupNameTable({'familyName': 'Superscripts', 'styleName': 'Regular'})
    fb.setupOS2(sTypoAscender=1005, sTypoDescender=-295, usWinAscent=1005, usWinDescent=295)
    fb.setupPost()
    fb.font.flavor = 'woff2'
    return fb.font


def named(font, name):
    for nid in (1, 4, 6):
        font['name'].setName(name, nid, 3, 1, 0x409)


def geist_sans(variable, weight, name):
    """A static Latin Geist Sans in TrueType outlines, so glyphs can be added to it."""
    font = instancer.instantiateVariableFont(TTFont(variable), {'wght': weight})
    options = Options()
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.notdef_outline = True
    sub = Subsetter(options)
    sub.populate(unicodes=[*range(0x20, 0x7F), *range(0xA0, 0x180), 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x2190, 0x2192, 0x2212, 0x221A, 0x2248, 0x2260, 0x2264, 0x2265, 0x03C0, 0x00D7, 0x00F7])
    sub.subset(font)
    named(font, name)
    return font


def main():
    fonts = Path(sys.argv[1])
    root = Path(__file__).resolve().parent.parent
    out = root / 'mobile/assets/fonts'
    mono = {w: TTFont(fonts / f'geist-mono/GeistMono-{w}.ttf') for w in ('Light', 'Regular', 'Medium', 'SemiBold')}
    web = root / 'src/assets'
    web.mkdir(exist_ok=True)
    standalone(supers(mono['Medium'])).save(web / 'Superscripts.woff2')
    # The phone app's fonts, in a checkout that has it.
    if not out.is_dir():
        return

    variable = fonts / 'geist-sans/Geist-Variable.ttf'
    for name, weight, donor in (('Geist-Light', 300, 'Light'), ('Geist-Regular', 400, 'Regular'), ('Geist-Medium', 500, 'Medium'), ('Geist-SemiBold', 600, 'SemiBold')):
        font = geist_sans(variable, weight, name)
        add_to(font, supers(mono[donor]))
        font.save(out / f'{name}.ttf')
    for name, donor in (('GeistMono-Medium', 'Medium'), ('IBMPlexMono-Medium', 'Medium'), ('IBMPlexMono-Bold', 'SemiBold'), ('IBMPlexSansCondensed-SemiBold', 'Medium')):
        path = out / f'{name}.ttf'
        font = TTFont(path)
        add_to(font, supers(mono[donor]))
        font.save(path)


if __name__ == '__main__':
    main()

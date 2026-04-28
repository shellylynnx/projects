#!/usr/bin/env python3
"""
Extract Birds Through an Opera Glass chapters from OCR'd page renders.

v2 strategy:
  1. Concatenate body OCR pages with explicit page markers.
  2. For each chapter, search forward (from the previous chapter's end) for
     its distinctive ALL-CAPS heading line. The body is everything after the
     heading up to (but not including) the next chapter's heading line.
  3. Strip running headers (left/right page furniture) once at the end.
  4. Reflow OCR line-breaks into clean paragraphs.

This handles the messy edge cases in the OCR:
  - Chapters whose heading appears mid-page (e.g., LIII Night-Hawk, where the
    heading sits at the bottom of a page that opens with the tail of LII).
  - Chapters whose first body page MANIFEST listed as PDF X but whose heading
    actually appears on PDF X-1 (e.g., XII Cuckoo, XX Yellow-Bird).
  - Chapters whose Roman numeral OCR'd as something un-Roman ("Lit." for LIII).
"""

import json
import os
import re
import sys
from typing import List, Tuple

OCR_DIR = "/tmp/opera-glass-extract/ocr"
OUT_JSON = "/tmp/opera-glass-extract/chapters.json"
REPORT = "/tmp/opera-glass-extract/extract_report.txt"

# Body content (the 70 chapters) lives in PDF pages 22..226 inclusive
# (book pp. 1..205). Front matter (preface, hints) sits before; back matter
# (appendix, books for reference, index) sits after — those are pulled in by
# extract_supplements() below and joined onto the chapter list with
# `type` = "front" or "back".
START_PDF, END_PDF = 22, 226
PDF_OFFSET = 21  # PDF page = book page + 21


# Supplementary sections (front matter + back matter). Each entry defines
# the PDF page range for the section and a short list of distinctive
# all-caps keywords used to recognise the running header AND the inline
# section heading line at the start.
#
# Skipped on purpose:
#   * Pigeon-Holes for Perching Birds diagram (PDF 227-228) — the diagram is
#     a visual chart that OCR can't capture meaningfully.
#   * The original two-column index (PDF 242-244) — the column layout
#     defeats Tesseract; we synthesise a clean alphabetical index from the
#     chapter manifest instead.

SUPPLEMENTS = [
    # (slug, type, title, start_pdf, end_pdf, header_keywords, head_re, end_re)
    # `end_re` is optional: if set, body extraction stops at the line BEFORE
    # the next section's heading on the same page range. Used when two
    # supplements share a PDF page (family-characteristics + classifications
    # both live around PDF 232).
    (
        "preface", "front", "Preface", 12, 14,
        ["PREFACE"],
        r"^PREFACE\.?$",
        None,
    ),
    (
        "hints-to-observers", "front", "Hints to Observers", 16, 17,
        ["HINTS", "OBSERVERS"],
        r"^HINTS\s+TO\s+OBSERVERS\.?$",
        None,
    ),
    (
        "appendix-family-characteristics", "back",
        "General Family Characteristics of Birds Treated", 229, 232,
        ["APPENDIX"],
        r"^GENERAL\s+FAMILY\s+CHARACTE.*",
        # Stops where the next appendix subsection begins
        r"^ARBITRARY\s+CLASSIFICATIONS.*",
    ),
    (
        "appendix-classifications", "back",
        "Arbitrary Classifications of Birds Described", 232, 240,
        ["APPENDIX"],
        r"^ARBITRARY\s+CLASSIFICATIONS.*",
        None,
    ),
    (
        "books-for-reference", "back", "Books for Reference", 241, 241,
        ["BOOKS", "REFERENCE"],
        r"^BOOKS\s+FOR\s+REFERENCE\.?$",
        None,
    ),
]


# Book page where each chapter's heading line lives in the body.
# Indexed by chapter number (1..70). Cross-checked against MANIFEST.md +
# running headers in the body OCR. Used only for the chapter's `bookPageStart`
# metadata field — body extraction works directly off heading-line search.
BOOK_PAGE_STARTS = {
    1: 4,   2: 10,  3: 14,  4: 16,  5: 18,  6: 20,  7: 25,  8: 32,
    9: 36,  10: 40, 11: 42, 12: 46, 13: 48, 14: 52, 15: 54, 16: 56,
    17: 60, 18: 65, 19: 68, 20: 76, 21: 80, 22: 82, 23: 84, 24: 86,
    25: 88, 26: 92, 27: 98, 28: 100,29: 104,30: 108,31: 112,32: 114,
    33: 118,34: 122,35: 124,36: 128,37: 130,38: 132,39: 138,40: 140,
    41: 144,42: 146,43: 150,44: 152,45: 154,46: 156,47: 158,48: 160,
    49: 162,50: 165,51: 166,52: 167,53: 169,54: 171,55: 172,56: 173,
    57: 174,58: 175,59: 177,60: 178,61: 180,62: 184,63: 186,64: 187,
    65: 189,66: 190,67: 191,68: 193,69: 198,70: 202,
}


# Illustrations per chapter (from MANIFEST.md).
# Map: chapter number -> filename (in assets/illustrations/).
ILLUSTRATIONS = {
    1:  "page026_robin.png",
    7:  "page047_bobolink-a.png",
    # Chapter VII has two illustrations; the second is exposed as a sibling
    # filename in the SPA but the primary card uses the first.
    10: "page062_meadow-lark.png",
    12: "page067_cuckoo.png",
    13: "page071_flicker.png",
    15: "page077_barn-swallow.png",
    16: "page079_belted-kingfisher.png",
    19: "page091_blue-jay.png",
    20: "page098_american-goldfinch.png",
    26: "page114_hairy-woodpecker.png",
    28: "page123_white-bellied-nuthatch.png",
    32: "page137_eastern-towhee.png",
    38: "page156_ovenbird.png",
    53: "page191_common-nighthawk.png",
    61: "page203_american-redstart.png",
}
# Chapter VII's second Bobolink illustration is exposed as a secondary file.
ILLUSTRATIONS_SECONDARY = {
    7: "page049_bobolink-b.png",
}


# Song-notation crops per chapter (from MANIFEST.md).
# Map: chapter number -> list of song-notation filenames.
SONG_NOTATIONS = {
    20: ["american-goldfinch_dee-ree.png"],
    23: [
        "wood-pewee_come-to-me.png",
        "wood-pewee_u-of-sound.png",
        "wood-pewee_dear-ie.png",
    ],
    30: ["white-throated-sparrow_pea-bod-dy.png"],
    38: ["ovenbird_teach-er-crescendo.png"],
    56: ["white-crowned-sparrow_whe-he-hee.png"],
    61: ["american-redstart_te-ka-teek.png"],
    64: ["black-throated-blue-warbler_z-ie.png"],
    70: [
        "hermit-thrush_main-song.png",
        "hermit-thrush_variation.png",
    ],
}


# Chapter manifest. The `head_re` is a regex anchored to a chapter-heading
# line in the OCR'd body. We search for the FIRST line that:
#   - is uppercase-dominant (a chapter title, not a sentence)
#   - matches the chapter's distinctive token(s)
# Patterns are CASE-INSENSITIVE on the upper-form of the line and require the
# matching line to look like a heading (not body prose).
#
# For chapters with very common English keywords (Robin, Crow), we anchor to
# "THE <BIRD>" so we don't false-positive on the running header running-text.
# Actually, since running headers are already stripped before search, we're OK
# matching on bare titles.
#
# Order is critical: we always search forward from the previous chapter's
# heading position, so duplicate titles don't cross-match.

CHAPTERS_RAW = [
    # (number, roman, title, slug, modernName, ebirdCode, head_pattern)
    (1,  "I",     "The Robin",                                                       "robin",                "American Robin",                  "amerob",  r"THE\s+ROBIN\.?$"),
    (2,  "II",    "The Crow",                                                        "crow",                 "American Crow",                   "amecro",  r"THE\s+C[KR]OW\.?$"),
    (3,  "III",   "The Bluebird",                                                    "bluebird",             "Eastern Bluebird",                "easblu",  r"THE\s+BLUEBIRD\.?$"),
    (4,  "IV",    "The Chimney Swift; Chimney “Swallow”",                            "chimney-swift",        "Chimney Swift",                   "chiswi",  r"(THE\s+)?CHIMNEY\s+SWIFT.*"),
    (5,  "V",     "Catbird",                                                         "catbird",              "Gray Catbird",                    "grycat",  r"^CATBIRD\.?$"),
    (6,  "VI",    "Keel-Tailed Blackbird; Crow Blackbird; Bronzed Grackle",          "crow-blackbird",       "Common Grackle",                  "comgra",  r"KEEL.?TAILED\s+BLACKBIRD.*|CROW\s+BLACKBIRD;?.*GRACKLE.*"),
    (7,  "VII",   "Bobolink; Reed-Bird; Rice-Bird",                                  "bobolink",             "Bobolink",                        "boboli",  r"BOBOLINK[\s;,].*REED.?BIRD.*"),
    (8,  "VIII",  "Ruffed Grouse; Partridge",                                        "ruffed-grouse",        "Ruffed Grouse",                   "rufgro",  r"RUFFED\s+GROUSE.*PARTRIDGE.*"),
    (9,  "IX",    "Ruby-Throated Humming-Bird",                                      "humming-bird",         "Ruby-throated Hummingbird",       "rthhum",  r"RUBY.?THRO.?A.?TED\s+HUMMING.?BIRD.*"),
    (10, "X",     "Meadow-Lark",                                                     "meadow-lark",          "Eastern Meadowlark",              "easmea",  r"MEADOW.?LARK\.?$"),
    (11, "XI",    "Black-Capped Chickadee; Titmouse",                                "chickadee",            "Black-capped Chickadee",          "bkcchi",  r"BLACK.?CAPPED\s+CHICKADEE.*"),
    (12, "XII",   "Yellow-Billed Cuckoo; Black-Billed Cuckoo",                       "cuckoo",               "Yellow-billed Cuckoo",            "yebcuc",  r"CUCKOO[;,].*RAIN\s*CROW.*|YELLOW.?BILLED\s+CUCKOO.*"),
    (13, "XIII",  "Yellow Hammer; Flicker",                                          "yellow-hammer",        "Northern Flicker",                "norfli",  r"YELLOW\s+HAMMER\s*[;,]\s*FLICKER.*"),
    (14, "XIV",   "Baltimore Oriole; Fire-Bird; Golden Robin; Hang-Bird",            "baltimore-oriole",     "Baltimore Oriole",                "balori",  r"BALTIMORE\s+ORIOLE.*"),
    (15, "XV",    "Barn Swallow",                                                    "barn-swallow",         "Barn Swallow",                    "barswa",  r"BAR[NM]\s+SWALLOW\.?$"),
    (16, "XVI",   "Belted Kingfisher",                                               "belted-kingfisher",    "Belted Kingfisher",               "belkin1", r"BELTED\s+KINGFISHER\.?$"),
    (17, "XVII",  "Chip-Bird; Chippy; Hair-Bird; Chipping Sparrow; Social Sparrow",  "chipping-sparrow",     "Chipping Sparrow",                "chispa",  r"CHIP.?BIRD.*CHIPPY.*"),
    (18, "XVIII", "Song Sparrow",                                                    "song-sparrow",         "Song Sparrow",                    "sonspa",  r"SONG\s+SPARROW\.?$"),
    (19, "XIX",   "Blue Jay",                                                        "blue-jay",             "Blue Jay",                        "blujay",  r"BLUE\s+JAY\.?$"),
    (20, "XX",    "Yellow-Bird; American Goldfinch; Thistle-Bird",                   "goldfinch",            "American Goldfinch",              "amegfi",  r"YELLOW.?BIRD\s*;?\s*AMERICAN\s+GOLDFINCH.*"),
    (21, "XXI",   "Phoebe",                                                          "phoebe",               "Eastern Phoebe",                  "easpho",  r"PH[O0@]?EBE\.?$"),
    (22, "XXII",  "Kingbird",                                                        "kingbird",             "Eastern Kingbird",                "easkin",  r"KINGBIRD([;,].*)?\.?$"),
    (23, "XXIII", "Wood Pewee",                                                      "wood-pewee",           "Eastern Wood-Pewee",              "eawpew",  r"WOOD\s+PEWEE\.?$"),
    (24, "XXIV",  "Least Flycatcher",                                                "least-flycatcher",     "Least Flycatcher",                "leafly",  r"LEAST\s+FLYCATCHER\.?$"),
    (25, "XXV",   "Red-Winged Blackbird",                                            "red-winged-blackbird", "Red-winged Blackbird",            "rewbla",  r"RED.?WINGED\s+BLACKBIRD\.?$"),
    (26, "XXVI",  "Hairy Woodpecker",                                                "hairy-woodpecker",     "Hairy Woodpecker",                "haiwoo",  r"HAIRY\s+WOODPECKER\.?$"),
    (27, "XXVII", "Downy Woodpecker",                                                "downy-woodpecker",     "Downy Woodpecker",                "dowwoo",  r"DOWNY\s+WOODPECKER\.?$"),
    (28, "XXVIII","White-Bellied Nuthatch; Devil-Down-Head",                         "nuthatch",             "White-breasted Nuthatch",         "whbnut",  r"WHITE.?BELLIED\s+NUTHATCH.*"),
    (29, "XXIX",  "Cowbird",                                                         "cowbird",              "Brown-headed Cowbird",            "bnhcow",  r"COWBIRD\.?$"),
    (30, "XXX",   "White-Throated Sparrow",                                          "white-throated-sparrow","White-throated Sparrow",         "whtspa",  r"WHITE.?THROATED\s+SPARROW\.?$"),
    (31, "XXXI",  "Cedar-Bird; Waxwing",                                             "cedar-waxwing",        "Cedar Waxwing",                   "cedwax",  r"CEDAR.?BIRD\s*;\s*WAXWING.*"),
    (32, "XXXII", "Chewink; Towhee",                                                 "towhee",               "Eastern Towhee",                  "eastow",  r"CHEWINK\s*;\s*TOWHEE.*"),
    (33, "XXXIII","Indigo-Bird",                                                     "indigo-bunting",       "Indigo Bunting",                  "indbun",  r"INDIGO.?BIRD\.?$"),
    (34, "XXXIV", "Purple Finch",                                                    "purple-finch",         "Purple Finch",                    "purfin",  r"PURPLE\s+FINCH\.?$"),
    (35, "XXXV",  "Red-Eyed Vireo",                                                  "red-eyed-vireo",       "Red-eyed Vireo",                  "reevir1", r"RED.?EYED\s+VIREO\.?$"),
    (36, "XXXVI", "Yellow-Throated Vireo",                                           "yellow-throated-vireo","Yellow-throated Vireo",           "yetvir",  r"YELLOW.?THROATED\s+VIREO\.?$"),
    (37, "XXXVII","Warbling Vireo",                                                  "warbling-vireo",       "Warbling Vireo",                  "warvir",  r"WARBLING\s+VIREO\.?$"),
    (38, "XXXVIII","Oven-Bird; Golden-Crowned Thrush",                               "ovenbird",             "Ovenbird",                        "ovenbi1", r"OVEN.?BIRD\s*;\s*GOLDEN.?CROWNED\s+THRUSH.*"),
    (39, "XXXIX", "Junco; Slate-Colored Snowbird",                                   "junco",                "Dark-eyed Junco",                 "daejun",  r"JUNCO\s*;\s*SLATE.?COLORED\s+SNOWBIRD.*"),
    (40, "XL",    "Kinglets",                                                        "kinglets",             "",                                "",        r"KINGLETS\.?$"),
    (41, "XLI",   "Snow Bunting; Snowflake",                                         "snow-bunting",         "Snow Bunting",                    "snobun",  r"SNOW\s+BUNTING\s*;\s*SNOWFLAKE.*"),
    (42, "XLII",  "Scarlet Tanager",                                                 "scarlet-tanager",      "Scarlet Tanager",                 "scatan",  r"SCARLET\s+TANAGER\.?$"),
    (43, "XLIII", "Brown Thrasher",                                                  "brown-thrasher",       "Brown Thrasher",                  "brnthr",  r"BROWN\s+THRASHER\.?$"),
    (44, "XLIV",  "Rose-Breasted Grosbeak",                                          "rose-breasted-grosbeak","Rose-breasted Grosbeak",         "rbgrbe",  r"ROSE.?BREASTED\s+GROSBEAK\.?$"),
    (45, "XLV",   "Whippoorwill",                                                    "whippoorwill",         "Eastern Whip-poor-will",          "ewpwil1", r"WHIPPOORWILL\.?$"),
    (46, "XLVI",  "Winter Wren",                                                     "winter-wren",          "Winter Wren",                     "winwre3", r"WINTER\s+WREN\.?$"),
    (47, "XLVII", "Red-Headed Woodpecker",                                           "red-headed-woodpecker","Red-headed Woodpecker",           "rehwoo",  r"RED.?HEADED\s+WOODPECKER\.?$"),
    (48, "XLVIII","Yellow-Bellied Sapsucker",                                        "yellow-bellied-sapsucker","Yellow-bellied Sapsucker",     "yebsap",  r"YELLOW.?BELLIED\s+SAPSUCKER\.?$"),
    (49, "XLIX",  "Great-Crested Flycatcher",                                        "great-crested-flycatcher","Great Crested Flycatcher",     "grcfly",  r"GREAT.?CRESTED\s+FLYCATCHER\.?$"),
    (50, "L",     "Bank Swallow; Sand Martin",                                       "bank-swallow",         "Bank Swallow",                    "banswa",  r"BANK\s+SWALLOW.*SAND\s+MARTIN.*"),
    (51, "LI",    "Cave Swallow; Cliff Swallow",                                     "cliff-swallow",        "Cliff Swallow",                   "cliswa",  r".*CLIFF\s+SWALLOW.*"),
    (52, "LII",   "Crossbills",                                                      "crossbills",           "Red Crossbill",                   "redcro",  r"CROSSBILLS\.?$"),
    (53, "LIII",  "Night-Hawk; Bull Bat",                                            "nighthawk",            "Common Nighthawk",                "comnig",  r"NIGHT.?HAWK\s*;\s*BULL\s+BAT.*"),
    (54, "LIV",   "Grass Finch; Vesper Sparrow; “Bay” Winged Bunting",               "vesper-sparrow",       "Vesper Sparrow",                  "vesspa",  r"GRASS\s+FINCH\s*;\s*VESPER\s+SPARROW.*"),
    (55, "LV",    "Tree Sparrow",                                                    "tree-sparrow",         "American Tree Sparrow",           "amtspa",  r"TREE\s+SPARROW\.?$"),
    (56, "LVI",   "White-Crowned Sparrow",                                           "white-crowned-sparrow","White-crowned Sparrow",           "whcspa",  r"WHITE.?CROWNED\s+SPARROW\.?$"),
    (57, "LVII",  "Field Sparrow; Bush Sparrow",                                     "field-sparrow",        "Field Sparrow",                   "fiespa",  r"FIELD\s+SPARROW\s*;\s*BUSH\s+SPARROW.*"),
    (58, "LVIII", "Fox Sparrow",                                                     "fox-sparrow",          "Fox Sparrow",                     "foxspa",  r"FOX\s+SPARROW\.?$"),
    (59, "LIX",   "Brown Creeper",                                                   "brown-creeper",        "Brown Creeper",                   "brncre",  r"BROWN\s+CREEPER\.?$"),
    (60, "LX",    "Summer Yellow-Bird; Golden Warbler; Yellow Warbler",              "yellow-warbler",       "Yellow Warbler",                  "yelwar",  r"SUMMER\s+YELLOW.?BIRD\s*;\s*GOLDEN\s+WARBLER.*"),
    (61, "LXI",   "Redstart",                                                        "redstart",             "American Redstart",               "amered",  r"REDSTART\.?$"),
    (62, "LXII",  "Black and White Creeping Warbler",                                "black-and-white-warbler","Black-and-white Warbler",       "bawwar",  r"BLACK\s+AND\s+WHITE\s+CREEPING\s+WARBLER\.?$"),
    (63, "LXIII", "Blackburnian Warbler; Hemlock Warbler; Orange-Throated Warbler",  "blackburnian-warbler", "Blackburnian Warbler",            "bkbwar",  r"BLACKBURNIAN\s+WARBLER\s*;\s*HEMLOCK\s+WARBLER.*"),
    (64, "LXIV",  "Black-Throated Blue Warbler",                                     "black-throated-blue-warbler","Black-throated Blue Warbler","btbwar",  r"BLACK.?THROATED\s+BLUE\s+WARBLER\.?$"),
    (65, "LXV",   "Yellow-Rumped Warbler; Myrtle Warbler",                           "yellow-rumped-warbler","Yellow-rumped Warbler",           "yerwar",  r"YELLOW.?RUMPED\s+WARBLER\s*;\s*MYRTLE\s+WARBLER.*"),
    (66, "LXVI",  "Chestnut-Sided Warbler",                                          "chestnut-sided-warbler","Chestnut-sided Warbler",         "chswar",  r"CHESTNUT.?SIDED\s+WARBLER\.?$"),
    (67, "LXVII", "Maryland Yellow-Throat; Black-Masked Ground Warbler",             "common-yellowthroat",  "Common Yellowthroat",             "comyel",  r"MARYLAND\s+YELLOW.?THROAT.*"),
    (68, "LXVIII","Thrushes",                                                        "thrushes",             "",                                "",        r"THRUSHES\.?$"),
    (69, "LXIX",  "Wilson’s Thrush; Veery; Tawny Thrush",                            "veery",                "Veery",                           "veery",   r"WILSON.?S\s+THRUSH\s*;\s*VEERY.*"),
    (70, "LXX",   "Hermit Thrush",                                                   "hermit-thrush",        "Hermit Thrush",                   "herthr",  r"HERMIT\s+THRUSH\.?$"),
]


# ---------------------------------------------------------------------------
# Running-header detection
# ---------------------------------------------------------------------------

# Left-page header: "<num> BIRDS THROUGH AN OPERA-GLASS." (with OCR drift like
# OVERA, TIIROUGH, BiRDS, etc.).
LEFT_HEADER_RE = re.compile(
    # Match a left-page running header. We anchor on a leading page number
    # plus the words OPERA (with OCR drift, e.g., OVERA) + GLASS, with
    # extremely lenient OCR drift in the words between (THROUGH, TIIROUGH,
    # TBROUGH, etc.). This is intentionally permissive: any line starting
    # with "<digits> ... <something>VERA-or-PERA ... GLASS" followed by
    # nothing else is page furniture.
    r"^[\s.,©*'’‘]*\d{1,3}[\s.,©*'’‘]*[A-Z][A-Z']{1,5}.*?O[VP][EB]RA[\s\-]*GLASS[.,©*\s]*$",
    re.IGNORECASE,
)
# Right-page header: "<TITLE>. <pagenum>" — uppercase fragment + dot + 1-3 digits/letters
# We require digits at the end (running pages have a page number) and nothing
# beyond it. We allow OCR drift in the title (mixed case), as long as the line
# is short and looks header-shaped.
RIGHT_HEADER_RE = re.compile(
    # The middle title-fragment allows letters/digits/hyphens/quotes/spaces/
    # periods AND em/en dashes — running headers for short adjacent chapters
    # are sometimes typeset together ("WHIPPOORWILL.— WINTER WREN. 155").
    # The gap between the title and the page number tolerates extra OCR
    # noise (e.g., "RED-WINGED BLACKBIRD. .- 89"). The page number itself
    # MUST contain at least one Arabic digit so a chapter-title-only line
    # like "BLUE JAY." or "THE CROW." is NOT mistaken for a header.
    r"^[\s.]*[A-Za-z][A-Za-z0-9\-—–’‘'\s.,]{2,50}\.[\s\-—–,.]*\d[A-Za-z0-9]{0,3}\s*\.?\s*$"
)
PAGE_ONLY_RE = re.compile(r"^[\s.]*\d{1,3}[\s.]*$")
SECTION_HEADER_RE = re.compile(r"^\s*WARBLERS\s*\.?\s*$", re.IGNORECASE)


def is_running_header(line: str) -> bool:
    l = line.strip()
    if not l:
        return False
    if LEFT_HEADER_RE.match(l):
        return True
    if PAGE_ONLY_RE.match(l):
        return True
    if SECTION_HEADER_RE.match(l):
        return True
    # Right-header guard: must be short, end with digit-like token, and contain
    # only ALL-CAPS letters and punctuation. Sentence-case prose like
    # "Tue blue jay comes with a dash and a flourish." passes ALL-CAPS
    # only after .upper() — so we test the ORIGINAL line.
    if len(l) > 50:
        return False
    # The original line must be uppercase-dominant. We allow at most 2
    # lowercase letters (OCR slip-ups like "BiRDS" or "cUucKoO").
    lowercase_ct = sum(1 for ch in l if ch.isalpha() and ch.islower())
    if lowercase_ct > 4:
        return False
    if RIGHT_HEADER_RE.match(l):
        return True
    return False


def strip_running_headers(text: str) -> str:
    out = []
    for line in text.splitlines():
        if is_running_header(line):
            continue
        out.append(line)
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Concatenate body OCR pages
# ---------------------------------------------------------------------------

def load_body_corpus() -> str:
    parts = []
    for n in range(START_PDF, END_PDF + 1):
        path = f"{OCR_DIR}/page-{n:03d}.txt"
        if not os.path.exists(path):
            continue
        with open(path) as f:
            raw = f.read()
        parts.append(raw)
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Forward search for chapter heading lines
# ---------------------------------------------------------------------------

def is_heading_line(line: str) -> bool:
    """A heading line is short, uppercase-dominant, and has a final '.' or ';'."""
    l = line.strip()
    if not l or len(l) > 70:
        return False
    # Allow OCR drift: at most 4 lowercase letters
    lowercase_ct = sum(1 for ch in l if ch.isalpha() and ch.islower())
    if lowercase_ct > 4:
        return False
    return True


def find_heading_position(corpus_lines: List[str], pattern: re.Pattern, start_idx: int) -> int:
    """Return the index of the first line at or after start_idx that:
       - looks heading-shaped (short, uppercase-dominant)
       - matches pattern (after .upper())
       - returns -1 if not found.
    """
    for i in range(start_idx, len(corpus_lines)):
        line = corpus_lines[i]
        if not is_heading_line(line):
            continue
        upper = line.strip().upper()
        # Strip a trailing period for matching but keep the original line intact
        upper_stripped = re.sub(r"[.\s]+$", "", upper)
        if pattern.search(upper) or pattern.search(upper_stripped):
            return i
    return -1


# ---------------------------------------------------------------------------
# Paragraph reflow
# ---------------------------------------------------------------------------

def clean_paragraphs(text: str) -> str:
    """Reflow OCR-broken lines into paragraphs.
    - Soft-hyphen line breaks: "wonder-\nful" → "wonderful".
    - Single newlines inside a paragraph become spaces.
    - Blank lines mark paragraph boundaries.
    - Runs of whitespace collapse to one.
    - Strip trailing OCR'd Roman-numeral artifacts left over from the *next*
      chapter's heading marker (e.g., "IL." for "II.", "VI." for "VI.",
      "» XX." with stray punctuation, "Lit." for "LIII.").
    """
    # Drop OCR artefacts
    text = text.replace("©", "")
    text = re.sub(r"[ \t]+", " ", text)
    # Soft hyphen at line end (ASCII hyphen, en/em dash, Unicode hyphens)
    text = re.sub(r"(\w)[‐‑‒\-]\s*\n\s*(\w)", r"\1\2", text)
    # Targeted OCR fixes (only unambiguous cases). Each entry is a word-
    # boundary substitution. Reviewed against every match in the body before
    # adding — no false positives observed.
    OCR_FIXES = [
        # Curly opening-quote + "I" merged into "T" (e.g., "“Tf you capture")
        (r"\bTf\b", "If"),
        # OCR'd "The"/"the" with "h" read as "n"
        (r"\bTne\b", "The"),
        (r"\btne\b", "the"),
        # OCR'd "The" with "h" read as "u" (15 occurrences across the body —
        # appears at chapter openings: "Tue robin", "Tue blue jay", etc.)
        (r"\bTue\b", "The"),
        # Same character pattern, different case (chapter openings where the
        # entire first word is set in small-caps and the OCR keeps the case).
        (r"\bTuE\b", "The"),
        # OCR'd "The" with "h" read as "a"
        (r"\bTae\b", "The"),
        # OCR'd "This" with "h" read as "u" and "is" read as "us"
        (r"\bTuus\b", "This"),
        # OCR'd "Throw" — the curly opening quote and the "h" merged into "x"
        (r"\bTxrow\b", "Throw"),
        # Two words merged because the space dropped
        (r"\bOna\b", "On a"),
        (r"\btoa\b", "to a"),
        (r"\basa\b", "as a"),
        # Chapter-opening words misread by OCR. Each of these only appears
        # once or twice in the corpus and is unambiguously a misread of a
        # well-known English word. Reviewed in context before adding.
        (r"\bWarcu\b", "Watch"),     # "Watch a chimney swift"
        (r"\bHicx\b", "Thick"),      # "Thick trees have an unsocial aspect"
        (r"\bTxoucH\b", "Though"),   # "Though the bluebird brings"
        (r"\bTxovucH\b", "Though"),  # "Though the white-throats"
        (r"\bDip\b", "Did"),         # "Did you ever see a humming-bird"
        (r"\bReap\b", "Read"),       # "Read Emerson's 'Titmouse'"
        (r"\bUntess\b", "Unless"),   # "Unless you follow the cuckoo"
        (r"\bWuen\b", "When"),       # "When people attempt", "When I first saw"
        (r"\bWitson\b", "Wilson"),   # "Wilson notices the interesting fact"
        (r"\bCrassine\b", "Classing"),  # "Classing the crow-blackbird"
        (r"\bIr\b", "If"),           # "If you have been in the country"
        (r"\bTuHE\b", "The"),        # "The sight of a chewink"
        (r"\bAmone\b", "Among"),     # "Among the songs"
        (r"\bEarty\b", "Early"),     # "Early in September"
        (r"\bLrxe\b", "Like"),       # "Like the vireos"
        (r"\bJusr\b", "Just"),       # "Just back of the Smith College"
        (r"\bLixe\b", "Like"),       # "Like the kingfisher"
        (r"\bBurroveus\b", "Burroughs"),  # "Mr. Burroughs calls"
        (r"\bAr\b", "At"),           # "At last we have a bird"
        (r"\bArter\b", "After"),     # "After spending a morning"
        # Mixed-case OCR (small-caps that should be normal Title-case)
        (r"\bCrossBILLs\b", "Crossbills"),
        # "fi" ligature misreads. The 1893 typesetting joins f+i into a single
        # ligature glyph that tesseract sometimes reads as "ft" or as "f'":
        (r"\bfteld\b", "field"),       # "in the fteld" → "in the field"
        (r"\bl'fting\b", "lifting"),    # "habit of l'fting" → "habit of lifting"
        # OCR'd "I" as a curly brace at start of word
        (r"\{n\b", "In"),               # "{n spring, when…" → "In spring, when…"
        # Trailing "ll" dropped from a proper noun, leaving a confusable stem
        (r"\bLowe gives\b", "Lowell gives"),  # crow-blackbird intro — Lowell's
                                              # Biglow Papers blackbird poem follows
        # Front-matter / appendix OCR errors
        (r"\bLirxe\b", "Like"),               # preface: "Like Snug the joiner"
        (r"\bWaren\b", "When"),               # hints: "When you begin to study"
        (r"«\s+few\b", "a few"),              # hints: "a few simple rules"
        (r"\bSizth\b", "Sixth"),              # hints: "Sixth. Make a practice of"
        (r"»\s+bit\b", "a bit"),              # hints: "a bit of moss"
        (r"\bond\b", "and"),                  # hints: "and the birds come to the spot"
        (r"undertone\s+—s\b", "undertone —a"),# hints: "undertone — a most obnoxious"
        (r"\btoselect\b", "to select"),       # hints: "is to select a good place"
        (r"\bflyeatcher\b", "flycatcher"),    # appendix: "least flycatcher"
        # Sublist marker "b." OCR'd as "’,". Bailey uses lowercase letter +
        # period (a., b., c., d.) for sub-classifications inside numbered
        # lists in the appendix. The "b." got read as a curly quote + comma.
        # Only fix at paragraph start so we don't touch quoted dialogue
        # mid-sentence.
        (r"(\A|\n\n)’,\s+(?=[A-Z])", r"\1b. "),
        # Word-merge OCR error
        (r"\bisalake\b", "is a lake"),        # hairy-woodpecker: "It is a lake!"
        # Letter-as-digit OCR errors (the "e" rendered as "2"/"0")
        (r"\bcircl2\b", "circle"),            # yellow-hammer: "a half circle as he bends"
        (r"\b4nd\b", "and"),                  # chipping-sparrow: "robins and chickadees"
        # Spelling-level OCR errors caught in the post-extraction audit pass
        (r"\bstaflungly\b", "startlingly"),   # fox-sparrow: "startlingly bluish-slate"
        (r"\breddith\b", "reddish"),          # fox-sparrow: "rich reddish-brown"
        (r"\bNorthampten\b", "Northampton"),  # bobolink (?): "Northampton, writes me"
        (r"\bsoniething\b", "something"),     # nuthatch: "or something else"
        (r"\bphabe\b", "phoebe"),             # 3 chapters: "the phœbe" ligature
        (r"\bphabes\b", "phoebes"),
        (r"\bexeept\b", "except"),            # appendix-family: 2 occurrences
        (r"\bburried\b", "hurried"),          # redstart, family-char: "hurried trill"
        (r"\bereeper\b", "creeper"),          # 2 occurrences in classifications
        (r"\beparrow\b", "sparrow"),          # appendix-classifications: 2 occurrences
        (r"\bete\b\.", "etc."),               # "etc" misread as "ete" (appears in family char)
        # Sweep #2 spelling-level OCR errors
        (r"\babont\b", "about"),              # indigo-bunting
        (r"\baequaintances\b", "acquaintances"),  # chestnut-sided-warbler
        (r"\baristoerats\b", "aristocrats"),  # great-crested-flycatcher
        (r"\barouna\b", "around"),            # bobolink
        (r"\bblackbarnian\b", "Blackburnian"),# appendix-classifications
        (r"\bblne\b", "blue"),                # appendix-classifications
        (r"\bbluc\b", "blue"),                # cliff-swallow
        (r"\bbufish\b", "buffish"),           # appendix-classifications
        (r"\bcharactevistic\b", "characteristic"),  # yellow-hammer
        (r"\bconyentional\b", "conventional"),# bobolink
        (r"\bacradle\b", "a cradle"),         # red-eyed-vireo
        (r"\barare\b", "a rare"),             # towhee
        (r"\barobin\b", "a robin"),           # chipping-sparrow
        (r"\barude\b", "a rude"),             # baltimore-oriole
        (r"\bconeshaped\b", "cone-shaped"),   # phoebe
        (r"\bbisl\b", "bird"),                # cedar-waxwing: "élite of bird circles"
        (r"\bwaxwing8\b", "waxwings"),        # cedar-waxwing
        # Song-notation OCR garble: replace each garbled region with an
        # inline marker `[[SONG:filename]]` that the SPA renders as the
        # actual cropped notation image. This puts the music notation back
        # where Bailey originally placed it in the body text. We anchor on
        # the prose surrounding the garble (rather than on the garble
        # itself) because the garble is wildly different across chapters.
        #
        # white-throated-sparrow: between "whistles, —" and " coming"
        (
            r"clear spring whistles,\s*—[\s\S]+?(?=\s+coming\s+from\s+the\s+wooded)",
            "clear spring whistles, [[SONG:white-throated-sparrow_pea-bod-dy.png]]",
        ),
        # hermit-thrush: main-song between "middle of each phrase" and "Variations"
        (
            r"middle\s+of\s+each\s+phrase[\s\S]+?(?=\s+Variations\s+from\s+this)",
            "middle of each phrase. [[SONG:hermit-thrush_main-song.png]]",
        ),
        # hermit-thrush: variation between "broken songs, as" and the next paragraph
        (
            r"broken\s+songs,\s*as:[\s\S]{1,80}?(?=\n\s*\n|\n[A-Z][a-z])",
            "broken songs, as follows. [[SONG:hermit-thrush_variation.png]]",
        ),
        # goldfinch: dee-ree between "rhythm" and "This way"
        (r"\bcf\s+his\s+own\s+(?:Al\s+r\s+aa\s+)?(?=This\s+way)",
         "of his own song [[SONG:american-goldfinch_dee-ree.png]] "),
        (r"\bdoe-roe\s+doo-ce-re0\s*,?\s*", ""),
        # ovenbird: teach-er-crescendo between "until the end, like" and "Ordinarily the trill"
        (
            r"until\s+the\s+end,\s+like[\s\S]+?(?=\s+Ordinarily\s+the\s+trill)",
            "until the end, like [[SONG:ovenbird_teach-er-crescendo.png]]",
        ),
        # redstart: te-ka-teek between "glad it was done." and "One morning"
        (
            r"as\s+if\s+glad\s+it\s+was\s+done\.[\s\S]+?(?=\s+One\s+morning)",
            "as if glad it was done. [[SONG:american-redstart_te-ka-teek.png]]",
        ),
        # white-crowned-sparrow: whe-he-hee between "something like —" and end of paragraph
        (
            r"something\s+like\s+—[\s\S]+?(?=\n\s*\n|\Z)",
            "something like — [[SONG:white-crowned-sparrow_whe-he-hee.png]]",
        ),
        # black-throated-blue-warbler: z-ie embedded inside "their z-<e guttural a / as
        # they hunt over the twigs and & 6 & / branches" — the OCR splits the
        # phrase across the notation glyph.
        (
            r"singing\s+their\s+z-<e\s+guttural\s+a\s+as\s+they\s+hunt\s+over\s+the\s+twigs\s+and\s+&\s*6\s*&\s+branches",
            "singing their guttural [[SONG:black-throated-blue-warbler_z-ie.png]] as they hunt over the twigs and branches",
        ),
        # wood-pewee: three notations interleaved with prose. The OCR for the
        # whole region is heavily fragmented (single tokens "er", "pe-eo",
        # "ryt", "ci" already stripped earlier as <14-char paragraphs).
        # What remains is messed-up prose; we splice the three notation
        # images into the description of "lisping… come to me… dear-ie"
        # phrasing.
        (
            r"It\s+has\s+moods\s+for\s+all\s+of\s+ours\.\s+Its\s+faint,\s+lisping[\s\S]+?(?=\s+with\s+the\s+liquidity)",
            "It has moods for all of ours. Its faint, lisping [[SONG:wood-pewee_come-to-me.png]] suggests all the happiness of domestic love and peace. At one moment its minor [[SONG:wood-pewee_u-of-sound.png]]",
        ),
        (
            r"is\s+fraught\s+with\s+all\s+the\s+pathos\s+and\s+yearning\s+of\s+a[\s\S]+?(?=\s+with\s+which\s+it\s+lulls)",
            "is fraught with all the pathos and yearning of a desolated human heart. At another, its tender, motherly [[SONG:wood-pewee_dear-ie.png]]",
        ),
        # Strip lingering garble cleanup
        (r"\bpee\s+leh\s+es\b", ""),
        (r"\brr\s+oobedg\s+be\s+v\s+teach-er(?:,?\s*teach-er)*\s*", ""),
        # Collapse runs of double+ spaces produced by replacements
        (r"  +", " "),
        # warbling-vireo, inside Brewer quote: "He is by far the sweetest…"
        # OCR'd "He" as "HK" and joined "is by" as "is-by".
        (r"\bHK is-by\b", "He is by"),
        # Opening curly quote with stray space — OCR consistently inserts a
        # space between the opening quote and the first letter of the
        # quoted phrase. Bailey's typesetting kept them flush. We strip the
        # space everywhere it appears.
        (r"“\s+(?=\S)", "“"),
        # Appendix classifications heading is mangled in OCR:
        # "I. Brrps rounp mm Certarn Locarties." → "I. Birds Found in Certain Localities."
        (r"\bBrrps\b", "Birds"),
        (r"\bLocarties\b", "Localities"),
        (r"\bCertarn\b", "Certain"),
        (r"\brounp\s+mm\b", "Found in"),
    ]
    for pat, rep in OCR_FIXES:
        text = re.sub(pat, rep, text)
    # Strip a leading curly-quote/apostrophe that appears at the start of a
    # paragraph, in front of an alphabetic chapter-opening word ("‘Witson",
    # "‘Jusr", "'WE", "‘The"). These come from the small-caps drop-cap
    # being read as a stray quote glyph.
    text = re.sub(r"(\A|\n\n)\s*[‘’'`]+\s*([A-Za-z])", r"\1\2", text)
    paragraphs = re.split(r"\n\s*\n", text)
    out = []
    for p in paragraphs:
        joined = re.sub(r"\s*\n\s*", " ", p).strip()
        joined = re.sub(r"\s{2,}", " ", joined)
        if not joined:
            continue
        # Drop very short non-sentence paragraphs that are almost certainly OCR
        # debris from Bailey's inline song-notation lyrics (e.g., "er",
        # "pe-eo", "ryt") or stray page-furniture leaks ("7 8"). Real prose
        # paragraphs always end with a sentence-terminating mark.
        if len(joined) <= 14 and not re.search(r"[.!?](?:[\"'’”])?\s*$", joined):
            continue
        # Drop short uppercase-dominant fragments that are leaked next-chapter
        # heading tokens (e.g., "BIRD.", "HANG-NEST.", "BUNTING.",
        # "LOW WARBLER.", "VIII. ."). These all show up as title leaks rather
        # than prose. Real prose has mixed case.
        if len(joined) <= 20:
            lc_letters = sum(1 for ch in joined if ch.isalpha() and ch.islower())
            if lc_letters == 0:
                continue
        # Drop any paragraph that is purely Roman-numeral-shaped (e.g.,
        # "XXXVIII.", "LO.", "Lit.").
        # Roman-numeral letters plus common OCR confusions (h, t, j read as I/L/V).
        roman_chars_in_para = "IVXLCDMHilvxlcdmhtj"
        if re.fullmatch(rf"[\s.»«*]*[{roman_chars_in_para}]{{1,8}}[.,;:\s]*", joined):
            continue
        out.append(joined)

    # ------------------------------------------------------------------
    # Mid-sentence page-break repair
    # ------------------------------------------------------------------
    # When a paragraph wraps from one PDF page to the next, the OCR'd page
    # break (running header + blank lines) gets read as a paragraph
    # boundary. Fix: walk through paragraphs and JOIN any pair where the
    # previous paragraph clearly doesn't end a sentence — i.e., it does NOT
    # end with one of (`.`, `!`, `?`) optionally followed by a closing quote.
    # We deliberately leave colons (`:`) and lone open-quote endings alone
    # so block-quote leads like "Longfellow says :" stay separated from the
    # quoted line that follows.
    # A paragraph "ends a sentence" if the last non-space char is .!? optionally
    # followed by a closing quote/paren/bracket. We accept ) ] " ' ’ ” after
    # the terminal mark so quoted speech and parenthetical asides terminate
    # cleanly.
    sentence_end = re.compile(r"[.!?](?:[\"'’”\)\]]+)?\s*$")
    # If the next paragraph starts with one of these markers it's clearly the
    # start of a list item Bailey set on its own line, NOT a continuation of
    # the previous paragraph. We never merge into one of these.
    list_marker_start = re.compile(
        r"^(?:\d+[.)]\s|"  # "1. " "2) "
        r"(?:First|Second|Third|Fourth|Fifth|Sixth|Sizth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth)[,.\s])",
        re.IGNORECASE,
    )
    merged: list[str] = []
    for p in out:
        # Strip leading stray colons and similar punctuation glyphs left over
        # from OCR'ing list-introducer lines like "rules will help you: \n\n
        # First," (the colon and the space sometimes ride alone).
        p_stripped = re.sub(r"^[\s:;]+", "", p)
        if (
            merged
            and not sentence_end.search(merged[-1])
            and not list_marker_start.match(p_stripped)
        ):
            # Continuation: join into the prior paragraph.
            merged[-1] = (merged[-1].rstrip() + " " + p_stripped.lstrip()).strip()
            merged[-1] = re.sub(r"\s{2,}", " ", merged[-1])
        else:
            merged.append(p_stripped)
    # After joining, also clean up stray trailing-colon-on-its-own that may
    # have been left at the END of a paragraph by OCR (e.g., "unobtrusive. :").
    merged = [re.sub(r"\s+:\s*$", "", m) for m in merged]
    out = merged
    # After paragraph reassembly, strip trailing-paragraph Roman-numeral debris
    # in two forms:
    #   1. The whole final paragraph is a short token like "IL." or "» XX." —
    #      drop the paragraph.
    #   2. The final paragraph ends with a stray short Roman-numeral-ish word —
    #      strip just the trailing word.
    # Roman-numeral letters plus common OCR confusions (h, t, j read as I/L/V).
    roman_chars = "IVXLCDMHilvxlcdmhtj"
    while out:
        last = out[-1].strip()
        if not last:
            out.pop()
            continue
        # Whole-paragraph debris: optional punctuation, then 1-6 roman chars,
        # then optional punctuation. Length cap of 8 catches "» XX." etc.
        if len(last) <= 8 and re.fullmatch(rf"[\s»«*.]*[{roman_chars}]{{1,6}}[.,;:]?", last):
            out.pop()
            continue
        # Trailing-word debris on an otherwise valid sentence
        new_last = re.sub(rf"\s+[{roman_chars}]{{1,6}}[.,;:]?\s*$", "", out[-1])
        if new_last != out[-1]:
            out[-1] = new_last
        break
    return "\n\n".join(out)


# ---------------------------------------------------------------------------
# Supplement extraction (front matter + back matter)
# ---------------------------------------------------------------------------

def is_supplement_running_header(line: str, keywords: list) -> bool:
    """Strip running headers like 'PREFACE. vii', 'x HINTS TO OBSERVERS.',
    'APPENDIX. 207'. The keyword list anchors which section we're in.

    Critically, this MUST NOT strip the section's own title heading
    ('PREFACE.', 'HINTS TO OBSERVERS.', 'BOOKS FOR REFERENCE.'). Those
    appear with the keyword alone, no page number. The running header
    always carries a page-number token alongside the keyword (Arabic
    digits in the body or back matter, lowercase roman in the front
    matter)."""
    l = line.strip()
    if not l or len(l) > 50:
        return False
    if PAGE_ONLY_RE.match(l):
        return True
    upper = l.upper()
    lowercase_ct = sum(1 for ch in l if ch.isalpha() and ch.islower())
    if lowercase_ct > 4:
        return False
    has_keyword = any(kw in upper for kw in keywords)
    if not has_keyword:
        return False
    # Page number on the same line — Arabic digit OR a short lowercase-roman
    # token (i/ii/iii/iv/v/vi/vii/viii/ix/x/xi/xii) for the front matter.
    has_arabic = bool(re.search(r"\d", l))
    has_lowroman = bool(re.search(r"\b[ivx]{1,5}\b", l))
    if has_arabic or has_lowroman:
        return True
    return False


def extract_supplement(pdf_start, pdf_end, header_keywords, head_re, end_re):
    """Pull a supplementary section from OCR pages [pdf_start, pdf_end].
    Strips running headers, finds the section's heading line, takes
    everything after up to (optionally) the end_re line, then runs
    clean_paragraphs on the result."""
    parts = []
    for n in range(pdf_start, pdf_end + 1):
        path = f"{OCR_DIR}/page-{n:03d}.txt"
        if not os.path.exists(path):
            continue
        with open(path) as f:
            parts.append(f.read())
    raw = "\n".join(parts)
    # Strip section-specific running headers
    cleaned = []
    for line in raw.splitlines():
        if is_supplement_running_header(line, header_keywords):
            continue
        cleaned.append(line)
    lines = cleaned
    head_pat = re.compile(head_re, re.IGNORECASE)
    end_pat = re.compile(end_re, re.IGNORECASE) if end_re else None

    # Find heading line
    head_idx = -1
    for i, ln in enumerate(lines):
        upper = ln.strip().upper()
        if head_pat.search(upper):
            head_idx = i
            break
    if head_idx < 0:
        print(f"  WARN  supplement heading not found ({head_re})", file=sys.stderr)
        return ""

    body_start = head_idx + 1
    # Skip continuation heading lines that wrap to a second OCR row
    # (e.g., "GENERAL FAMILY CHARACTERISTICS OF BIRDS / TREATED.")
    while body_start < len(lines):
        ln = lines[body_start].strip()
        if not ln:
            body_start += 1
            continue
        if is_heading_line(ln):
            body_start += 1
            continue
        break

    # Find end if end_re given
    body_end = len(lines)
    if end_pat:
        for i in range(body_start, len(lines)):
            upper = lines[i].strip().upper()
            if end_pat.search(upper):
                body_end = i
                break

    # Pre-process: detect short uppercase-dominant lines that look like
    # subsection headings (e.g., "CUCKOOS.", "KINGFISHERS.", "FLYCATCHERS,")
    # and convert each to its own markdown-style heading paragraph so it
    # renders cleanly instead of glueing onto the description below it.
    body_lines = lines[body_start:body_end]
    # First, collapse soft-hyphen line breaks within heading lines (a heading
    # like "XI. Birds … When Not NeEsT-/ING." straddles two OCR rows; we want
    # the joined form so the dict lookup hits).
    body_lines = join_soft_hyphenated_headings(body_lines)
    body_lines = mark_subsection_headings(body_lines)
    body_text = "\n".join(body_lines)
    body_text = clean_paragraphs(body_text)
    # Same small-caps normalisation we apply to chapter openings: a leading
    # ALL-CAPS word becomes Title-case so the body reads as prose ("THE…" →
    # "The…", "WHEN" → "When").
    body_text = re.sub(
        r"^(\s*)([A-Z]{2,})(\b)",
        lambda m: m.group(1) + m.group(2).capitalize() + m.group(3),
        body_text,
    )
    return body_text


FAMILY_HEADINGS = {
    "CUCKOOS", "KINGFISHERS", "WOODPECKERS", "GOATSUCKERS", "SWIFTS",
    "HUMMING-BIRDS", "HUMMINGBIRDS", "FLYCATCHERS", "CROWS AND JAYS",
    "BLACKBIRDS AND ORIOLES", "SPARROWS AND FINCHES", "TANAGERS", "SWALLOWS",
    "WAXWINGS", "VIREOS", "WOOD WARBLERS", "CREEPERS", "NUTHATCHES AND TITS",
    "KINGLETS", "THRUSHES",
}


# Bailey sets the appendix-classifications top-level headings ("I. Birds Found
# in Certain Localities.", "II. Size Compared with the Robin.", etc.) in
# small-caps in the original — and Tesseract butchers small-caps badly. The
# OCR-mangled forms are too varied to clean up with word-boundary regexes,
# so we map each known garbled form to its proper rendering. Compared
# against the source on book pages 211-219.
CLASSIFICATION_HEADING_FIXES = {
    "I. Brrps rounp mm Certarn Locarties.": "I. Birds Found in Certain Localities.",
    "IL. Size coMPARED wiTH THE RosIn.":     "II. Size Compared with the Robin.",
    "TIL. Coors.":                            "III. Colors.",
    "IV. Sones.":                             "IV. Songs.",
    "V. Pecuniarrries or Fuca.":              "V. Peculiarities of Flight.",
    "VI. Brros wit Hasrr or Sone-Fuieat.":    "VI. Birds with Habit of Song-Flight.",
    "VII. Marxep Hasirts.":                   "VII. Marked Habits.",
    "VIII. Bravs raat WALK INSTEAD oF Horpinc.": "VIII. Birds that Walk Instead of Hopping.",
    "IX. Saar or Bru apaprep to Foon.":       "IX. Shape of Bill Adapted to Food.",
    "X. Wuere Certain Brrps Nest.":           "X. Where Certain Birds Nest.",
    # The XI. heading wraps across two OCR lines (NeEsT-/ING.); after we
    # collapse soft-hyphen line breaks earlier in clean_paragraphs the
    # joined form is "Birds THAT ARE SEEN IN FLocKs WHEN NoT NeEsTING."
    "XI. Birds THAT ARE SEEN IN FLocKs WHEN NoT NeEsTING.":
        "XI. Birds that Are Seen in Flocks when Not Nesting.",
    # Pre-fix variant (in case "Brrps" hasn't been substituted yet)
    "XI. Brrps THAT ARE SEEN IN FLocKs WHEN NoT NeEsTING.":
        "XI. Birds that Are Seen in Flocks when Not Nesting.",
}


def join_soft_hyphenated_headings(lines: list) -> list:
    """Join consecutive non-blank OCR rows where the first row ends with a
    soft hyphen (e.g., "…NeEsT-" then "ING." on the next row). We only
    operate on lines that look heading-shaped (uppercase-dominant, short)
    so we don't accidentally rewrap actual prose paragraphs."""
    out = []
    skip_next = False
    for i, line in enumerate(lines):
        if skip_next:
            skip_next = False
            continue
        if i + 1 < len(lines):
            cur = line.rstrip()
            nxt = lines[i + 1].lstrip()
            # Only join if cur ends with a hyphen+letter pattern AND looks
            # heading-shaped on both rows (high uppercase ratio, short).
            # Allow up to 14 lowercase letters: small-caps headings get
            # mauled by OCR badly (e.g., XI heading has 10 lowercase chars
            # in mostly-uppercase prose).
            if (
                cur.endswith("-")
                and 5 <= len(cur) <= 80
                and 1 <= len(nxt) <= 12
                and sum(1 for c in cur if c.isalpha() and c.islower()) <= 14
            ):
                joined = cur[:-1] + nxt
                out.append(joined)
                skip_next = True
                continue
        out.append(line)
    return out


def mark_subsection_headings(lines: list) -> list:
    """Detect short ALL-CAPS-or-near subsection headings (e.g. "CUCKOOS.",
    "KINGFISHERS.", "BLACKBIRDS AND ORIOLES.") and rewrite each as a
    markdown ### heading on its own paragraph, with blank lines on either
    side so clean_paragraphs treats it as its own block. The rewritten
    text is Title-cased ("Cuckoos.", "Blackbirds and Orioles.") so the
    rendered HTML reads as prose.

    Context guard: a true subsection heading sits on its own line in OCR,
    preceded by a blank line. Without this guard, "as in the / goatsuckers."
    would be miscategorised — that "goatsuckers." is a sentence continuation,
    not a new section.
    """
    # Normalise the dict keys once for trailing-punct-tolerant lookup.
    norm_class_fixes = {
        re.sub(r"[\s.,;:\-]+$", "", k): v
        for k, v in CLASSIFICATION_HEADING_FIXES.items()
    }
    out = []
    for i, line in enumerate(lines):
        l = line.strip()
        # Path 1: Roman-numeral classification heading (matched against a
        # curated list of OCR-garbled forms). Normalise both the candidate
        # AND the dict keys by stripping trailing punctuation drift, so
        # "XI…NeEsTING. -" matches the dict entry "XI…NeEsTING.".
        candidate = re.sub(r"[\s.,;:\-]+$", "", l)
        fixed = norm_class_fixes.get(candidate)
        if fixed:
            out.append("")
            out.append(f"### {fixed}")
            out.append("")
            continue
        if not l or len(l) > 40:
            out.append(line)
            continue
        if l[-1] not in ".,":
            out.append(line)
            continue
        letters = sum(1 for c in l if c.isalpha())
        if letters < 4:
            out.append(line)
            continue
        # Strip a leading curly quote / apostrophe before the family-name match
        # — OCR sometimes reads the small-caps drop-cap as a stray quote glyph
        # (e.g., "‘HUMMING-BIRDS." instead of "HUMMING-BIRDS.").
        stripped = re.sub(r"^[‘’'`]+\s*", "", l).rstrip(".,").strip()
        upper_norm = stripped.upper()
        is_known_family = upper_norm in FAMILY_HEADINGS
        lc = sum(1 for c in l if c.isalpha() and c.islower())
        is_caps_dominant = lc <= 3
        if not (is_known_family or is_caps_dominant):
            out.append(line)
            continue
        # Skip pure roman numerals
        roman_only = re.fullmatch(r"[\s.,»«*]*[IVXLCDMHilvxlcdmhtj]{1,8}[.,]?\s*", l)
        if roman_only:
            out.append(line)
            continue
        # Context guard: previous non-blank line must end with a sentence-
        # terminating mark, OR be blank. If the previous line ends mid-
        # sentence, this candidate is most likely a continuation of that
        # sentence (e.g., the line "as in the\ngoatsuckers." case).
        j = i - 1
        while j >= 0 and not lines[j].strip():
            j -= 1
        if j >= 0:
            prev = lines[j].strip()
            if not re.search(r"[.!?](?:[\"'’”\)\]]+)?\s*$", prev):
                out.append(line)
                continue
        title = " ".join(w.capitalize() if w.upper() != "AND" else "and" for w in stripped.split())
        out.append("")
        out.append(f"### {title}.")
        out.append("")
    return out


def synthesise_index(chapters: list) -> str:
    """The Riverside Press 1893 edition's two-column index does not OCR
    cleanly. Build a synthetic alphabetical index from the chapter
    manifest instead. Each chapter (and each of its semicolon-separated
    period aliases) becomes an entry that points at the chapter's slug.
    The text is markdown-style with relative hash links, so the SPA
    can render it in the existing chapter body container.
    """
    entries: list[tuple[str, str, str]] = []  # (label, slug, romanref)
    for c in chapters:
        # Primary title
        primary = c["title"].split(";")[0].strip()
        entries.append((primary, c["slug"], c["roman"]))
        # Period aliases
        aliases = [s.strip() for s in c["title"].split(";")[1:]]
        for a in aliases:
            if a:
                entries.append((a, c["slug"], c["roman"]))
        # Modern name (so a reader searching "American Robin" hits it)
        if c.get("modernName"):
            mn = c["modernName"].strip()
            if mn and mn != primary:
                entries.append((mn, c["slug"], c["roman"]))

    # Dedupe (label, slug) pairs — modern names that match the period title
    # would otherwise generate the same line twice.
    seen = set()
    unique_entries = []
    for e in entries:
        key = (e[0].lower(), e[1])
        if key in seen:
            continue
        seen.add(key)
        unique_entries.append(e)
    entries = unique_entries

    entries.sort(key=lambda e: (e[0].lower(), e[1]))

    lines = [
        "Below is a synthesised alphabetical index of every bird Bailey "
        "treats by chapter, including the period vernacular names she lists "
        "in each chapter title. Each entry links to the chapter that covers "
        "it.",
        "",
        "Bailey's original printed index was set in two columns and groups "
        "additional cross-references (anatomy, classification, locality) "
        "alongside species names; the original page layout doesn't OCR "
        "reliably, so this is a simplified replacement. The full original "
        "index is at the [Internet Archive scan]"
        "(https://archive.org/details/birdsthroughano00bailgoog) on book "
        "pages 221–224.",
        "",
    ]
    last_initial = ""
    for label, slug, roman in entries:
        initial = label[0].upper()
        if initial != last_initial:
            lines.append("")
            lines.append(f"### {initial}")
            lines.append("")
            last_initial = initial
        lines.append(f"- [{label}](#/{slug}) · chapter {roman}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main():
    raw_corpus = load_body_corpus()
    stripped = strip_running_headers(raw_corpus)
    lines = stripped.splitlines()

    chapter_starts = []  # (idx, num, roman, title, ...) — heading line index
    cursor = 0
    for spec in CHAPTERS_RAW:
        num, roman, title, slug, modern, ebird, head_re = spec
        pat = re.compile(head_re, re.IGNORECASE)
        idx = find_heading_position(lines, pat, cursor)
        if idx < 0:
            print(f"  WARN  no heading found for chapter {num} ({title})", file=sys.stderr)
            # Fallback: keep cursor where it was, body will be empty
            chapter_starts.append((cursor, num, roman, title, slug, modern, ebird))
            continue
        chapter_starts.append((idx, num, roman, title, slug, modern, ebird))
        cursor = idx + 1

    chapters_out = []
    report_lines = []
    for i, (start_idx, num, roman, title, slug, modern, ebird) in enumerate(chapter_starts):
        # Body starts AFTER the heading line itself.
        body_start = start_idx + 1
        # Some chapter titles wrap to a second OCR line (e.g., chapter XVII
        # is "CHIP-BIRD OR CHIPPY; HAIR-BIRD; CHIPPING / SPARROW; SOCIAL
        # SPARROW."). Skip continuation heading-shaped lines until we hit
        # real prose. We keep this conservative: only skip if the next line
        # is uppercase-dominant AND short (≤60 chars).
        while body_start < len(lines):
            ln = lines[body_start].strip()
            if not ln:
                body_start += 1
                continue
            if is_heading_line(ln):
                # Heading continuation: skip it
                body_start += 1
                continue
            break

        if i + 1 < len(chapter_starts):
            body_end = chapter_starts[i + 1][0]
        else:
            body_end = len(lines)
        body_text = "\n".join(lines[body_start:body_end])
        body_text = clean_paragraphs(body_text)
        # Normalise small-caps chapter openings: Bailey's typesetter sets the
        # first word of each chapter in small caps (e.g., "THE robin lives…"),
        # which the OCR captures as either "Tue" / "Tae" (already substituted
        # above) or as an honest "THE" / "WHEN" all-caps token. Convert any
        # ALL-CAPS leading word to title case so the body reads as prose and
        # so the CSS drop-cap on `:first-letter` looks right.
        body_text = re.sub(
            r"^(\s*)([A-Z]{2,})(\b)",
            lambda m: m.group(1) + m.group(2).capitalize() + m.group(3),
            body_text,
        )

        # Estimate book page where the chapter heading line was — we re-derive
        # this from the original concatenation by counting lines per page, but
        # cheaper: keep a static map from manifest. For now we'll skip the
        # exact pdfPageStart and just record the chapter ordering.
        book_pg = BOOK_PAGE_STARTS.get(num, 0)
        illus = ILLUSTRATIONS.get(num, "")
        illus_extra = ILLUSTRATIONS_SECONDARY.get(num)
        songs = SONG_NOTATIONS.get(num, [])
        entry = {
            "type": "chapter",
            "number": num,
            "roman": roman,
            "title": title,
            "modernName": modern,
            "periodAliases": [],
            "bookPageStart": book_pg,
            "pdfPageStart": book_pg + PDF_OFFSET if book_pg else 0,
            "slug": slug,
            "text": body_text,
            "illustration": illus,
            "songNotations": songs,
            "ebirdCode": ebird,
        }
        if illus_extra:
            entry["illustrationSecondary"] = illus_extra
        # If the body now contains [[SONG:filename]] inline markers, the
        # corresponding notations have been placed where Bailey originally
        # set them in the book — drop them from `songNotations` so they
        # aren't ALSO duplicated in a separate block at the bottom of the
        # chapter.
        inlined = set(re.findall(r"\[\[SONG:([^\]]+)\]\]", body_text))
        if inlined:
            entry["songNotations"] = [
                f for f in entry["songNotations"] if f not in inlined
            ]
        chapters_out.append(entry)
        word_count = len(body_text.split())
        report_lines.append(
            f"{num:>3} {roman:<7} {title[:48]:<48} heading@line {start_idx:>5}  body {word_count:>4} words"
        )

    # ----- Supplements (front matter + back matter) -----
    front_entries = []
    back_entries = []
    for spec in SUPPLEMENTS:
        slug, kind, title, ps, pe, kws, head_re, end_re = spec
        text = extract_supplement(ps, pe, kws, head_re, end_re)
        entry = {
            "type": kind,
            "number": 0,
            "roman": "",
            "title": title,
            "modernName": "",
            "periodAliases": [],
            "bookPageStart": 0,
            "pdfPageStart": ps,
            "slug": slug,
            "text": text,
            "illustration": "",
            "songNotations": [],
            "ebirdCode": "",
        }
        if kind == "front":
            front_entries.append(entry)
        else:
            back_entries.append(entry)
        wc = len(text.split())
        report_lines.append(
            f"  {kind:<5} {title[:48]:<48}                       body {wc:>4} words"
        )

    # Pigeon-holes diagram (PDF 227-228 / book pp. 206-207). The diagram is
    # set sideways across two facing pages in the original; the pre-rotated
    # images sit at assets/appendix-pages/. We insert this BEFORE the rest
    # of the appendix so it appears in book order.
    pigeon_holes_entry = {
        "type": "back",
        "number": 0,
        "roman": "",
        "title": "Pigeon-Holes for the Perching Birds Mentioned in this Book",
        "modernName": "",
        "periodAliases": [],
        "bookPageStart": 206,
        "pdfPageStart": 227,
        "slug": "appendix-pigeon-holes",
        "text": (
            "Bailey's pigeon-hole diagram organises every perching bird she "
            "treats into fourteen labelled categories, with a fifteenth "
            "column (\"DRAWER\") for the woodpeckers, cuckoos, kingfisher, "
            "and other non-perching birds covered in the book. The diagram "
            "was originally typeset sideways across two facing pages; the "
            "scans below have been rotated upright for screen reading."
        ),
        "illustration": "",
        "songNotations": [],
        "ebirdCode": "",
        "appendixPages": ["pigeon-holes-1.jpg", "pigeon-holes-2.jpg"],
    }
    back_entries.insert(0, pigeon_holes_entry)

    # Synthesised alphabetical index — at the very end
    index_text = synthesise_index(chapters_out)
    back_entries.append({
        "type": "back",
        "number": 0,
        "roman": "",
        "title": "Index",
        "modernName": "",
        "periodAliases": [],
        "bookPageStart": 0,
        "pdfPageStart": 242,
        "slug": "index",
        "text": index_text,
        "illustration": "",
        "songNotations": [],
        "ebirdCode": "",
    })

    # Final order: front matter, then chapters, then back matter
    all_entries = front_entries + chapters_out + back_entries

    with open(OUT_JSON, "w") as f:
        json.dump(all_entries, f, indent=2, ensure_ascii=False)

    with open(REPORT, "w") as f:
        f.write("\n".join(report_lines))
        f.write("\n")

    print("\n".join(report_lines))
    print(
        f"\nWrote {len(all_entries)} entries "
        f"({len(front_entries)} front, {len(chapters_out)} chapters, "
        f"{len(back_entries)} back) to {OUT_JSON}"
    )


if __name__ == "__main__":
    main()

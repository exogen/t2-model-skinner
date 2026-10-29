import { BASE_PATH, getLocalAssetUrl } from "../deployPaths";
import { containedVideoRect } from "../videoRect";
import "./photoStrip.module.css";

// The strip is styled after a printed 35mm photo booth strip: black film with
// rounded frames and muted-gold edge print. It opens like a resort postcard,
// "Hello from" in script over the Tribes 2 logo with the skins site's address
// under it, and each photo has a letter-spaced caption below it: the skin
// name, the model and the armor class.

export const STRIP_WIDTH = 800;
const SIDE = 76; // black margin left and right of the photos
export const PHOTO_WIDTH = STRIP_WIDTH - SIDE * 2;
export const PHOTO_HEIGHT = (PHOTO_WIDTH * 3) / 4;
const PHOTO_RADIUS = 22;
const TOP = 32; // strip edge to the top of "Hello from"
const HEADER_GAP = 34; // the site address's baseline to the first photo
const MIN_BAND = 66; // the caption band below each photo; grows when a caption wraps
const BAND_PADDING = 22; // from the caption's cap height to the photos
const END = 12; // extra black after the last caption's band, to match the top

const BLACK = "#080808";
const GOLD = "#d8c690"; // edge print and the site address
const AMBER = "#f5b54e"; // captions, like a camera display
const INK = "#ecebe6"; // the script
const TEAL = "#2a9d97"; // the script's shade, a brighter take on the photos' teal
const PRINT_EDGE = "rgba(236, 235, 230, 0.1)"; // keeps dark photo edges off the black

// Safari's generic monospace is Courier, so sans monos come first.
const MONO =
  '"Share Tech Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
const SCRIPT = '"Yellowtail", cursive';

export interface StripCaption {
  skin: string;
  /** Like "Human Male". */
  model: string;
  /** Like "Light armor". */
  armor: string;
}

type Picture = HTMLImageElement | HTMLCanvasElement;

export interface StripArt {
  /** The Tribes 2 logo, or text standing in for it if it couldn't load. */
  logo: Picture;
}

/** Only the parts of a 2D context that captions are measured with, so tests
 * can measure with a fake. */
type Measurer = Pick<CanvasRenderingContext2D, "font" | "measureText">;

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create an image.");
  return { canvas, context };
}

function naturalSize(picture: Picture) {
  return "naturalWidth" in picture
    ? [picture.naturalWidth, picture.naturalHeight]
    : [picture.width, picture.height];
}

/** The captured frame, scaled to fit and centered, over `background` cropped
 * to fill the photo, or over the app's background gradient. */
export function renderPhoto(
  frame: HTMLCanvasElement,
  width = frame.width,
  height = frame.height,
  background: Picture | null = null,
) {
  const { canvas, context } = createCanvas(width, height);
  context.imageSmoothingQuality = "high";
  if (background) {
    const [backgroundWidth, backgroundHeight] = naturalSize(background);
    const scale = Math.max(width / backgroundWidth, height / backgroundHeight);
    const drawWidth = backgroundWidth * scale;
    const drawHeight = backgroundHeight * scale;
    context.drawImage(
      background,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  } else {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#124044");
    gradient.addColorStop(1, "#001720");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
  const rect = containedVideoRect(width, height, frame.width, frame.height);
  if (rect) context.drawImage(frame, rect.x, rect.y, rect.width, rect.height);
  return canvas;
}

/** The strip for the photo booth's captured frames, each photo over its own
 * background, or over the gradient when `backgrounds` has none for it. */
export function renderBoothStrip(
  frames: readonly HTMLCanvasElement[],
  caption: StripCaption,
  art: StripArt,
  backgrounds: readonly Picture[],
) {
  return renderPhotoStrip(
    frames.map((frame, index) =>
      renderPhoto(frame, PHOTO_WIDTH, PHOTO_HEIGHT, backgrounds[index] ?? null),
    ),
    caption,
    art,
  );
}

let art: Promise<StripArt> | null = null;

/** The strip's fonts and logo. Never rejects: without them the strip falls
 * back to system fonts and text in place of the logo, and the next call tries
 * the logo again. */
export function loadStripArt(): Promise<StripArt> {
  art ??= Promise.all([
    loadFonts(),
    loadImage(getLocalAssetUrl(BASE_PATH, "tribes2-logo.png")),
  ]).then(([, logo]) => {
    if (!logo) art = null;
    return logo ? { logo } : fallbackStripArt();
  });
  return art;
}

/** What the strip draws with when its logo isn't available. */
export function fallbackStripArt(): StripArt {
  return { logo: wordmark() };
}

async function loadFonts() {
  try {
    await Promise.all(
      [captionFont(CAPTION_SIZE), helloFont].map((font) =>
        document.fonts.load(font),
      ),
    );
  } catch {
    // Drawn with the fallback fonts.
  }
}

/** An image, or null if it can't load. */
export function loadImage(
  url: string,
  crossOrigin?: string,
): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = document.createElement("img");
    if (crossOrigin) image.crossOrigin = crossOrigin;
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** "TRIBES 2" in the logo's wordmark area, on a canvas the logo's size, so
 * the header lays out the same. */
function wordmark() {
  const { canvas, context } = createCanvas(LOGO_WIDTH, LOGO_HEIGHT);
  const { left, right, top, bottom } = WORDMARK;
  context.fillStyle = GOLD;
  context.font = `900 ${Math.round(LOGO_HEIGHT * (bottom - top))}px Impact, "Arial Black", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    "TRIBES 2",
    ((left + right) / 2) * LOGO_WIDTH,
    ((top + bottom) / 2) * LOGO_HEIGHT,
    (right - left) * LOGO_WIDTH,
  );
  return canvas;
}

/** The photos on a strip of film under "Hello from" the Tribes 2 logo, each
 * with its caption below it. Draw it once loadStripArt() has resolved, so the
 * fonts are ready. Its height depends on the captions. */
export function renderPhotoStrip(
  photos: readonly HTMLCanvasElement[],
  caption: StripCaption,
  { logo }: StripArt,
) {
  const measure = createCanvas(1, 1).context;
  const captions = captionLayouts(measure, [
    caption.skin,
    caption.model,
    caption.armor,
  ]);
  const band = Math.max(
    MIN_BAND,
    ...captions.map((layout) =>
      layout ? Math.ceil(layout.blockHeight + BAND_PADDING * 2) : 0,
    ),
  );
  const header = layoutHeader(measure, logo);
  const firstTop = header.bottom + HEADER_GAP;
  const period = PHOTO_HEIGHT + band;
  const frameTop = (index: number) => firstTop + index * period;
  const height = frameTop(photos.length) + END;

  const { canvas, context } = createCanvas(STRIP_WIDTH, height);
  context.fillStyle = BLACK;
  context.fillRect(0, 0, STRIP_WIDTH, height);
  // Like a roll of film, the edge print repeats once per frame, beside the
  // header too.
  context.fillStyle = GOLD;
  for (
    let index = -Math.ceil(firstTop / period);
    frameTop(index) < height;
    index++
  ) {
    drawEdgePrint(context, frameTop(index), height);
  }
  photos.forEach((photo, index) => {
    drawPhoto(context, photo, frameTop(index));
    const layout = captions[index];
    if (layout)
      drawCaption(context, layout, frameTop(index) + PHOTO_HEIGHT + band / 2);
  });
  drawHeader(context, header, logo);
  return canvas;
}

function drawPhoto(
  context: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  top: number,
) {
  context.save();
  context.beginPath();
  context.roundRect(SIDE, top, PHOTO_WIDTH, PHOTO_HEIGHT, PHOTO_RADIUS);
  context.clip();
  context.imageSmoothingQuality = "high";
  context.drawImage(photo, SIDE, top, PHOTO_WIDTH, PHOTO_HEIGHT);
  context.restore();
  // A faint print edge, inset so the whole stroke lies on the photo.
  context.save();
  context.strokeStyle = PRINT_EDGE;
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(
    SIDE + 0.75,
    top + 0.75,
    PHOTO_WIDTH - 1.5,
    PHOTO_HEIGHT - 1.5,
    PHOTO_RADIUS - 0.75,
  );
  context.stroke();
  context.restore();
}

// One repeat of edge print per frame, placed relative to the photo's top edge,
// like the markings on 35mm film. Left: short dashes on a fixed pitch in groups
// of 2-4-2-7-3; the first pair straddles the gap above the photo. Right: a
// tall triangle at the top of the frame, and a little past halfway down a
// thick-over-thin double bar above a small triangle.
const DASH = { x: 33, width: 30, height: 12, pitch: 18.5, firstCenter: -23 };
const DASH_GROUPS = [
  [0, 2], // [first slot, dash count]
  [3, 4],
  [10, 2],
  [16, 7],
  [24, 3],
];
const MARK_X = 766; // center line of the right-hand marks
const TOP_TRIANGLE = { top: 10, width: 23, height: 32 };
const DOUBLE_BAR = { top: 266, width: 32, thick: 11, gap: 5, thin: 8 };
const BAR_TRIANGLE = { top: 295, width: 21, height: 25 };
const EDGE_CLEARANCE = 12; // marks stay this far from the strip's ends

function drawEdgePrint(
  context: CanvasRenderingContext2D,
  photoTop: number,
  height: number,
) {
  // Each mark is drawn whole or not at all, so the strip never starts or ends
  // on a cut-off group.
  const fits = (top: number, bottom: number) =>
    top >= EDGE_CLEARANCE && bottom <= height - EDGE_CLEARANCE;
  for (const [first, count] of DASH_GROUPS) {
    const top =
      photoTop + DASH.firstCenter + first * DASH.pitch - DASH.height / 2;
    if (!fits(top, top + (count - 1) * DASH.pitch + DASH.height)) continue;
    for (let index = 0; index < count; index++) {
      context.fillRect(
        DASH.x,
        Math.round(top + index * DASH.pitch),
        DASH.width,
        DASH.height,
      );
    }
  }
  const triangleTop = photoTop + TOP_TRIANGLE.top;
  if (fits(triangleTop, triangleTop + TOP_TRIANGLE.height)) {
    triangle(
      context,
      MARK_X,
      triangleTop,
      TOP_TRIANGLE.width,
      TOP_TRIANGLE.height,
    );
  }
  const barTop = photoTop + DOUBLE_BAR.top;
  if (fits(barTop, photoTop + BAR_TRIANGLE.top + BAR_TRIANGLE.height)) {
    const left = MARK_X - DOUBLE_BAR.width / 2;
    context.fillRect(left, barTop, DOUBLE_BAR.width, DOUBLE_BAR.thick);
    context.fillRect(
      left,
      barTop + DOUBLE_BAR.thick + DOUBLE_BAR.gap,
      DOUBLE_BAR.width,
      DOUBLE_BAR.thin,
    );
    triangle(
      context,
      MARK_X,
      photoTop + BAR_TRIANGLE.top,
      BAR_TRIANGLE.width,
      BAR_TRIANGLE.height,
    );
  }
}

function triangle(
  context: CanvasRenderingContext2D,
  centerX: number,
  apexY: number,
  width: number,
  height: number,
) {
  context.beginPath();
  context.moveTo(centerX, apexY);
  context.lineTo(centerX + width / 2, apexY + height);
  context.lineTo(centerX - width / 2, apexY + height);
  context.closePath();
  context.fill();
}

// Captions are letter-spaced amber capitals in Share Tech Mono, all at one size. A
// long caption first loses letter spacing, then size; then it wraps onto two
// balanced lines (mid-word only if no break between words fits), and only then
// is its second line cut short with "…".
const CAPTION_SIZE = 28;
const CAPTION_TRACKING = 0.2; // em of extra space between characters
const LINE_PITCH = 1.25; // em, baseline to baseline
const SIZE_STEP = 0.5;

interface FitLimits {
  maxWidth: number;
  minSize: number;
  maxSize: number;
  /** em */
  minTracking: number;
}

const ONE_LINE: FitLimits = {
  maxWidth: 560,
  minSize: 24,
  maxSize: CAPTION_SIZE,
  minTracking: 0.1,
};
// Two lines are never set larger than one line could be, so a longer name
// doesn't come out bigger.
const TWO_LINES: FitLimits = {
  maxWidth: 600,
  minSize: 20,
  maxSize: ONE_LINE.minSize,
  minTracking: 0.06,
};

interface CaptionFit {
  /** Each line's graphemes. A right-to-left caption is one unspaced string. */
  lines: string[][];
  size: number;
  /** Extra space between characters, in px. */
  tracking: number;
}

interface CaptionLayout extends CaptionFit {
  /** Cap height, which the caption is centered on. */
  cap: number;
  /** Baseline to baseline. */
  pitch: number;
  blockHeight: number;
}

const captionFont = (size: number) => `${size}px ${MONO}`;

/** Each photo's caption, all at the size the longest one needs, so the skin
 * name is never smaller than the others. An empty caption is null. */
export function captionLayouts(
  context: Measurer,
  texts: readonly string[],
): (CaptionLayout | null)[] {
  const fits = texts.map((text) => {
    const clean = cleanText(text);
    return clean ? fitCaption(context, clean) : null;
  });
  const size = Math.min(...fits.map((fit) => fit?.size ?? Infinity));
  return fits.map(
    (fit) =>
      fit &&
      withMetrics(
        context,
        fit.size === size ? fit : refit(context, fit.lines, size),
      ),
  );
}

function cleanText(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase();
}

// Text is handled as grapheme clusters, so accents and composed emoji stay
// whole when spaced, measured, broken or cut.
const segmenter =
  typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;
function graphemes(text: string) {
  return segmenter
    ? Array.from(segmenter.segment(text), (part) => part.segment)
    : Array.from(text);
}

function trimSpaces(glyphs: string[]) {
  let start = 0;
  let end = glyphs.length;
  while (start < end && glyphs[start] === " ") start++;
  while (end > start && glyphs[end - 1] === " ") end--;
  return glyphs.slice(start, end);
}

function spacedWidth(
  context: Measurer,
  glyphs: readonly string[],
  tracking: number,
) {
  let width = 0;
  for (const glyph of glyphs) width += context.measureText(glyph).width;
  return width + tracking * Math.max(0, glyphs.length - 1);
}

// Right-to-left scripts can't be spaced one character at a time. Skin names
// come from file names too, so they can be in any script. (Built with RegExp
// because this tsconfig's ES5 target rejects the u flag.)
const RIGHT_TO_LEFT = new RegExp(
  "[\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Syriac}\\p{Script=Thaana}\\p{Script=Nko}]",
  "u",
);

function fitCaption(context: Measurer, text: string): CaptionFit {
  if (RIGHT_TO_LEFT.test(text)) return unspacedLine(context, text);
  const glyphs = graphemes(text);
  const everyBreak = glyphs.map((_, index) => index);
  return (
    fitLines(context, [glyphs], ONE_LINE) ??
    fitLines(
      context,
      balancedLines(context, glyphs, wordBreaks(glyphs)),
      TWO_LINES,
    ) ??
    fitLines(context, balancedLines(context, glyphs, everyBreak), TWO_LINES) ??
    truncatedLines(context, glyphs)
  );
}

/** The largest size within the limits at which every line fits maxWidth with
 * at least the minimum letter spacing, and the spacing closest to the full
 * spacing that still fits. */
function fitLines(
  context: Measurer,
  lines: string[][] | null,
  limits: FitLimits,
): CaptionFit | null {
  if (!lines) return null;
  for (let size = limits.maxSize; size >= limits.minSize; size -= SIZE_STEP) {
    context.font = captionFont(size);
    let tracking = CAPTION_TRACKING * size;
    for (const glyphs of lines) {
      const bare = spacedWidth(context, glyphs, 0);
      if (bare > limits.maxWidth) tracking = -Infinity;
      else if (glyphs.length > 1)
        tracking = Math.min(
          tracking,
          (limits.maxWidth - bare) / (glyphs.length - 1),
        );
    }
    if (tracking >= limits.minTracking * size) return { lines, size, tracking };
  }
  return null;
}

/** The same lines at a smaller size, with as much spacing as fits. */
function refit(context: Measurer, lines: string[][], size: number): CaptionFit {
  const maxWidth = lines.length > 1 ? TWO_LINES.maxWidth : ONE_LINE.maxWidth;
  return (
    fitLines(context, lines, {
      maxWidth,
      minSize: size,
      maxSize: size,
      minTracking: 0,
    }) ?? { lines, size, tracking: 0 }
  );
}

/** Where a line may break between words: at a space, or after the "-" or "_"
 * that many skin names use instead of spaces. */
function wordBreaks(glyphs: string[]) {
  return glyphs.flatMap((glyph, index) =>
    glyph === " " ? [index] : glyph === "-" || glyph === "_" ? [index + 1] : [],
  );
}

// Letters of scripts whose words get a hyphen when broken across lines.
const HYPHENATED = new RegExp(
  "^[\\p{Script=Latin}\\p{Script=Greek}\\p{Script=Cyrillic}]",
  "u",
);

/** The lines before and after a break position; a word split in two gets a
 * hyphen. */
function breakAt(glyphs: string[], index: number) {
  const first = trimSpaces(glyphs.slice(0, index));
  const second = trimSpaces(glyphs.slice(index));
  const splitsWord = glyphs[index - 1] !== " " && glyphs[index] !== " ";
  if (
    splitsWord &&
    HYPHENATED.test(first[first.length - 1] ?? "") &&
    HYPHENATED.test(second[0] ?? "")
  ) {
    first.push("-");
  }
  return [first, second];
}

/** Two lines, split at whichever of the break positions makes the longer
 * line shortest. */
function balancedLines(context: Measurer, glyphs: string[], breaks: number[]) {
  context.font = captionFont(CAPTION_SIZE);
  const tracking = TWO_LINES.minTracking * CAPTION_SIZE;
  let best: { lines: string[][]; width: number } | null = null;
  for (const index of breaks) {
    const lines = breakAt(glyphs, index);
    if (!lines[0].length || !lines[1].length) continue;
    const width = Math.max(
      ...lines.map((line) => spacedWidth(context, line, tracking)),
    );
    if (!best || width < best.width) best = { lines, width };
  }
  return best?.lines ?? null;
}

/** The last resort, at the smallest size: fill the first line, breaking
 * between words if that keeps it at least half full, and cut the second line
 * short with "…". */
function truncatedLines(context: Measurer, glyphs: string[]): CaptionFit {
  const { maxWidth, minSize: size } = TWO_LINES;
  const tracking = TWO_LINES.minTracking * size;
  context.font = captionFont(size);
  const fits = (line: string[]) =>
    spacedWidth(context, line, tracking) <= maxWidth;
  // Fill the first line, leaving room for a hyphen.
  let end = 1;
  while (end < glyphs.length && fits([...glyphs.slice(0, end + 1), "-"])) end++;
  const space = glyphs.lastIndexOf(" ", end);
  if (space > end / 2) end = space;
  const [first, rest] = breakAt(glyphs, end);
  let second = rest;
  while (second.length && !fits([...second, "…"]))
    second = trimSpaces(second.slice(0, -1));
  return { lines: [first, [...second, "…"]], size, tracking };
}

/** One line drawn as a single string, so the browser orders and joins its
 * letters: as large as fits, else cut short with "…" at the smallest size. */
function unspacedLine(context: Measurer, text: string): CaptionFit {
  const fits = (line: string) =>
    context.measureText(line).width <= ONE_LINE.maxWidth;
  for (let size = CAPTION_SIZE; size >= TWO_LINES.minSize; size -= SIZE_STEP) {
    context.font = captionFont(size);
    if (fits(text)) return { lines: [[text]], size, tracking: 0 };
  }
  context.font = captionFont(TWO_LINES.minSize);
  let glyphs = graphemes(text);
  while (glyphs.length > 1 && !fits(`${glyphs.join("").trimEnd()}…`))
    glyphs = glyphs.slice(0, -1);
  return {
    lines: [[`${glyphs.join("").trimEnd()}…`]],
    size: TWO_LINES.minSize,
    tracking: 0,
  };
}

function withMetrics(context: Measurer, fit: CaptionFit): CaptionLayout {
  context.font = captionFont(fit.size);
  const cap = context.measureText("H").actualBoundingBoxAscent;
  const pitch = fit.size * LINE_PITCH;
  return {
    ...fit,
    cap,
    pitch,
    blockHeight: cap + (fit.lines.length - 1) * pitch,
  };
}

/** Centers the caption's cap height on centerY. */
function drawCaption(
  context: CanvasRenderingContext2D,
  layout: CaptionLayout,
  centerY: number,
) {
  context.save();
  context.font = captionFont(layout.size);
  const firstBaseline = centerY - layout.blockHeight / 2 + layout.cap;
  layout.lines.forEach((glyphs, index) => {
    const x = (STRIP_WIDTH - spacedWidth(context, glyphs, layout.tracking)) / 2;
    drawSpaced(
      context,
      glyphs,
      x,
      Math.round(firstBaseline + index * layout.pitch),
      layout.tracking,
      AMBER,
    );
  });
  context.restore();
}

/** Letter-spaced text from x, in the context's current font. */
function drawSpaced(
  context: CanvasRenderingContext2D,
  glyphs: readonly string[],
  x: number,
  baseline: number,
  tracking: number,
  color: string,
) {
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = color;
  for (const glyph of glyphs) {
    context.fillText(glyph, x, baseline);
    x += context.measureText(glyph).width + tracking;
  }
}

// The header: "Hello from" in a 1950s postcard script, tilted, at the left,
// and the Tribes 2 logo at the right, so the script starts left of TRIBES and
// rests on its top edge. Sign-painted: a teal shade, and a strip-colored
// outline that cuts the script out of the logo where they overlap. The skins
// site's address is centered under TRIBES, beside the badge.
const HELLO = "Hello from";
const HELLO_SIZE = 92;
const HELLO_TILT = (-6 * Math.PI) / 180; // rising to the right
const HELLO_OVERLAP = 10; // px the script's lowest point reaches into the logo
const KNOCKOUT = 9; // outline width
const SHADE = { dx: 4, dy: 5, gap: 3.5 }; // offset of the teal shade, and its dark gap
const helloFont = `${HELLO_SIZE}px ${SCRIPT}`;
// public/tribes2-logo.png is drawn at its own size.
const LOGO_WIDTH = 580;
const LOGO_HEIGHT = 177;
// Where the logo's artwork is, as fractions of the image. Its drop shadow
// (lower right) is lost on black, so the layout follows the art. WORDMARK is
// "TRIBES" without the badge, down to the R's leg.
const LOGO_ART = { left: 0.004, right: 0.976, top: 0.013, bottom: 0.913 };
const WORDMARK = { left: 0.004, right: 0.789, top: 0.013, bottom: 0.684 };

const SITE = "SKINS.TRIBES2.ONLINE";
const SITE_SIZE = 24;
const SITE_TRACKING = 0.12; // em
const SITE_GAP = 16; // TRIBES to the address's cap height; the address fits left of the badge
const siteFont = `${SITE_SIZE}px ${MONO}`;

interface HeaderLayout {
  helloX: number;
  helloY: number;
  logoX: number;
  logoTop: number;
  logoHeight: number;
  siteBaseline: number;
  bottom: number;
}

function layoutHeader(context: Measurer, logo: Picture): HeaderLayout {
  const [naturalWidth, naturalHeight] = naturalSize(logo);
  const logoHeight = (LOGO_WIDTH * naturalHeight) / naturalWidth;
  // The logo's artwork ends at the photos' right edge, and the script starts
  // at their left edge, going by its glyph boxes (the slanted H's ink starts
  // a few px inside). Whole pixels keep the logo sharp.
  const logoX = Math.round(SIDE + PHOTO_WIDTH - LOGO_ART.right * LOGO_WIDTH);
  context.font = helloFont;
  const ink = tiltedInk(context, HELLO, HELLO_TILT);
  const helloY = TOP - ink.top;
  const logoTop = Math.round(
    helloY + ink.bottom - HELLO_OVERLAP - LOGO_ART.top * logoHeight,
  );
  context.font = siteFont;
  const siteBaseline = Math.round(
    logoTop +
      WORDMARK.bottom * logoHeight +
      SITE_GAP +
      context.measureText("H").actualBoundingBoxAscent,
  );
  // The address has no descenders.
  const bottom = Math.max(
    siteBaseline,
    Math.round(logoTop + LOGO_ART.bottom * logoHeight),
  );
  return {
    helloX: SIDE - ink.left,
    helloY,
    logoX,
    logoTop,
    logoHeight,
    siteBaseline,
    bottom,
  };
}

/** How far a rotated line of text reaches left of and above (negative) and
 * below its baseline origin, from each glyph's measured ink bounds. */
function tiltedInk(context: Measurer, text: string, angle: number) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  let left = Infinity;
  let top = 0;
  let bottom = 0;
  let before = "";
  for (const glyph of graphemes(text)) {
    const x = context.measureText(before).width;
    const ink = context.measureText(glyph);
    for (const gx of [
      x - ink.actualBoundingBoxLeft,
      x + ink.actualBoundingBoxRight,
    ]) {
      for (const gy of [
        -ink.actualBoundingBoxAscent,
        ink.actualBoundingBoxDescent,
      ]) {
        left = Math.min(left, gx * cos - gy * sin);
        const y = gx * sin + gy * cos;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    before += glyph;
  }
  return { left, top, bottom };
}

function drawHeader(
  context: CanvasRenderingContext2D,
  header: HeaderLayout,
  logo: Picture,
) {
  const { logoX, logoTop, logoHeight } = header;
  context.drawImage(logo, logoX, logoTop, LOGO_WIDTH, logoHeight);

  // Back to front: a strip-colored outline around the shade and the letters,
  // which cuts them out of the logo; the shade; a thin dark gap around the
  // letters; the letters.
  context.save();
  context.translate(header.helloX, header.helloY);
  context.rotate(HELLO_TILT);
  context.font = helloFont;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.lineJoin = "round";
  context.strokeStyle = BLACK;
  context.lineWidth = KNOCKOUT;
  context.strokeText(HELLO, SHADE.dx, SHADE.dy);
  context.strokeText(HELLO, 0, 0);
  context.fillStyle = TEAL;
  context.fillText(HELLO, SHADE.dx, SHADE.dy);
  context.lineWidth = SHADE.gap;
  context.strokeText(HELLO, 0, 0);
  context.fillStyle = INK;
  context.fillText(HELLO, 0, 0);
  context.restore();

  context.save();
  context.font = siteFont;
  const glyphs = graphemes(SITE);
  const tracking = SITE_TRACKING * SITE_SIZE;
  drawSpaced(
    context,
    glyphs,
    (STRIP_WIDTH - spacedWidth(context, glyphs, tracking)) / 2,
    header.siteBaseline,
    tracking,
    GOLD,
  );
  context.restore();
}

const zlib = require("zlib");
const { cleanText } = require("./article-agents/text-utils");

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1080;

const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
  ",": ["00000", "00000", "00000", "00000", "00100", "00100", "01000"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
};

const UNKNOWN_GLYPH = ["11111", "00001", "00010", "00100", "00000", "00100", "00000"];

function color(hex) {
  const normalized = String(hex || "").replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
    a: 255,
  };
}

function mix(left, right, ratio) {
  return {
    r: Math.round(left.r + (right.r - left.r) * ratio),
    g: Math.round(left.g + (right.g - left.g) * ratio),
    b: Math.round(left.b + (right.b - left.b) * ratio),
    a: 255,
  };
}

function createCanvas(width, height) {
  const data = Buffer.alloc(width * height * 4);
  return { width, height, data };
}

function setPixel(canvas, x, y, rgba) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const idx = (y * canvas.width + x) * 4;
  canvas.data[idx] = rgba.r;
  canvas.data[idx + 1] = rgba.g;
  canvas.data[idx + 2] = rgba.b;
  canvas.data[idx + 3] = rgba.a ?? 255;
}

function fillRect(canvas, x, y, width, height, rgba) {
  const startX = Math.max(0, Math.round(x));
  const startY = Math.max(0, Math.round(y));
  const endX = Math.min(canvas.width, Math.round(x + width));
  const endY = Math.min(canvas.height, Math.round(y + height));
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) setPixel(canvas, px, py, rgba);
  }
}

function drawGradient(canvas, topHex, bottomHex) {
  const top = color(topHex);
  const bottom = color(bottomHex);
  for (let y = 0; y < canvas.height; y += 1) {
    const rowColor = mix(top, bottom, y / Math.max(1, canvas.height - 1));
    fillRect(canvas, 0, y, canvas.width, 1, rowColor);
  }
}

function drawGlyph(canvas, char, x, y, scale, rgba) {
  const glyph = GLYPHS[char] || UNKNOWN_GLYPH;
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") fillRect(canvas, x + col * scale, y + row * scale, scale, scale, rgba);
    }
  }
}

function drawText(canvas, text, x, y, scale, rgba, options = {}) {
  const maxWidth = options.maxWidth || canvas.width - x * 2;
  const lineHeight = options.lineHeight || scale * 9;
  const charWidth = scale * 6;
  const maxChars = Math.max(1, Math.floor(maxWidth / charWidth));
  const lines = wrapText(text, maxChars).slice(0, options.maxLines || 99);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].toUpperCase();
    for (let i = 0; i < line.length; i += 1) {
      drawGlyph(canvas, line[i], x + i * charWidth, y + lineIndex * lineHeight, scale, rgba);
    }
  }
  return { lines, height: lines.length * lineHeight };
}

function wrapText(value, maxChars) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word.length > maxChars ? word.slice(0, maxChars - 1) : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(canvas) {
  const raw = Buffer.alloc((canvas.width * 4 + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const rawOffset = y * (canvas.width * 4 + 1);
    raw[rawOffset] = 0;
    canvas.data.copy(raw, rawOffset + 1, y * canvas.width * 4, (y + 1) * canvas.width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND"),
  ]);
}

function renderInstagramCardPng(context = {}) {
  const title = cleanText(context.cardTitle || context.title || "Live News story");
  const subtitle = cleanText(context.cardSubtitle || context.summary || "");
  const source = cleanText(context.sourceLabel || context.sourceAttribution || context.source || "Original source");
  const category = cleanText(context.category || "Live News coverage");
  const url = cleanText(context.exactArticleUrl || "newsmorenow.com");
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);

  drawGradient(canvas, "#10243a", "#c4a766");
  fillRect(canvas, 46, 46, 988, 988, { ...color("#f4f7fb"), a: 255 });
  fillRect(canvas, 68, 68, 944, 944, color("#132842"));
  fillRect(canvas, 68, 68, 944, 14, color("#d0ad67"));
  fillRect(canvas, 68, 910, 944, 102, color("#0c1d31"));

  drawText(canvas, "LIVE NEWS", 96, 110, 9, color("#f8fbff"), { maxWidth: 880, maxLines: 1 });
  drawText(canvas, "ANYTIME & ANYWHERE", 96, 190, 4, color("#d0ad67"), { maxWidth: 880, maxLines: 1 });
  drawText(canvas, title, 96, 285, 8, color("#ffffff"), { maxWidth: 880, maxLines: 5, lineHeight: 78 });
  if (subtitle) {
    drawText(canvas, subtitle, 96, 710, 4, color("#dce7f2"), { maxWidth: 860, maxLines: 3, lineHeight: 44 });
  }
  drawText(canvas, `${source} • ${category}`, 96, 936, 4, color("#ffffff"), { maxWidth: 860, maxLines: 1 });
  drawText(canvas, url.replace(/^https?:\/\//i, ""), 96, 982, 3, color("#d0ad67"), { maxWidth: 860, maxLines: 1 });

  return encodePng(canvas);
}

module.exports = {
  CARD_HEIGHT,
  CARD_WIDTH,
  renderInstagramCardPng,
};

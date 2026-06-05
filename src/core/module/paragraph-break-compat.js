// Backwards-compatibility layer for legacy consumers of
// `char.paragraphBreakAfter`.

function median(values) {
  if (values.length === 0) {
    return NaN;
  }

  values.sort((a, b) => a - b);

  const half = Math.floor(values.length / 2);
  if (values.length % 2) {
    return values[half];
  }
  return (values[half - 1] + values[half]) / 2;
}

function getLineMetrics(chars, line) {
  const bottomValues = [];
  const topValues = [];
  const fontCount = Object.create(null);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  for (let i = line.start; i <= line.end; i++) {
    const char = chars[i];
    const rect = char.rect;
    if (rect[0] < x0) x0 = rect[0];
    if (rect[1] < y0) y0 = rect[1];
    if (rect[2] > x1) x1 = rect[2];
    if (rect[3] > y1) y1 = rect[3];

    if (char.rotation === 0) {
      bottomValues.push(rect[1]);
      topValues.push(rect[3]);
    } else if (char.rotation === 90) {
      bottomValues.push(rect[2]);
      topValues.push(rect[0]);
    } else if (char.rotation === 180) {
      bottomValues.push(rect[3]);
      topValues.push(rect[1]);
    } else if (char.rotation === 270) {
      bottomValues.push(rect[0]);
      topValues.push(rect[2]);
    }

    // Match the legacy `chars.slice(line.start, line.end)` call, where `end`
    // was accidentally treated as exclusive.
    if (i < line.end) {
      const fontName = char.fontName;
      fontCount[fontName] = (fontCount[fontName] || 0) + 1;
    }
  }

  let mostCommonFont = null;
  let maxCount = 0;
  for (const fontName in fontCount) {
    if (fontCount[fontName] > maxCount) {
      maxCount = fontCount[fontName];
      mostCommonFont = fontName;
    }
  }

  const top = median(topValues);
  const bottom = median(bottomValues);
  return {
    start: line.start,
    end: line.end,
    top,
    bottom,
    height: top - bottom,
    rect: [x0, y0, x1, y1],
    fontName: mostCommonFont,
  };
}

function getLines(chars) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].lineBreakAfter || i === chars.length - 1) {
      lines.push({ start, end: i });
      start = i + 1;
    }
  }
  return lines;
}

function applyParagraphBreakAfterCompat(chars, lineMetrics = null) {
  for (const char of chars) {
    delete char.paragraphBreakAfter;
  }

  if (!chars.length) {
    return chars;
  }

  const lines = lineMetrics || getLines(chars);
  const metrics = lineMetrics || lines.map(line => getLineMetrics(chars, line));
  const lineSpacings = [];
  for (let i = 0; i < lines.length - 1; i++) {
    lineSpacings.push(metrics[i].bottom - metrics[i + 1].top);
  }

  const MAX_LINE_SPACING = 5;
  const MIN_LINE_SPACING = -2;
  const MAX_LINE_SPACING_CHANGE = 2;
  const isGapValid = gap => gap >= MIN_LINE_SPACING && gap <= MAX_LINE_SPACING;

  for (let i = 0; i < lines.length - 1; i++) {
    const currentLine = lines[i];
    const currentMetrics = metrics[i];
    const nextMetrics = metrics[i + 1];
    const currentRect = currentMetrics.rect;
    const nextRect = nextMetrics.rect;
    const currentLineSpacing = lineSpacings[i];
    const nextLineSpacing = lineSpacings[i + 1];
    const currentLineHeight = currentMetrics.height;
    const nextLineHeight = nextMetrics.height;

    let allowGap = false;
    if (isGapValid(currentLineSpacing) && !isGapValid(nextLineSpacing)) {
      allowGap = true;
    } else if (isGapValid(currentLineSpacing) && isGapValid(nextLineSpacing)) {
      if (
        Math.abs(currentLineSpacing - nextLineSpacing) < MAX_LINE_SPACING_CHANGE
      ) {
        allowGap = true;
      } else if (currentLineSpacing < nextLineSpacing) {
        allowGap = true;
      }
    }

    if (
      !allowGap ||
      !(currentRect[1] > nextRect[3]) ||
      (currentMetrics.fontName !== nextMetrics.fontName &&
        currentRect[2] < nextRect[2] - 10) ||
      Math.abs(currentLineHeight - nextLineHeight) > 2
    ) {
      chars[currentLine.end].paragraphBreakAfter = true;
    }
  }

  chars.at(-1).paragraphBreakAfter = true;
  return chars;
}

export { applyParagraphBreakAfterCompat, getLineMetrics };

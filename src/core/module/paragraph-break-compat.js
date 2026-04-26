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

function getLineBottom(chars, line) {
  const values = [];
  for (let i = line.start; i <= line.end; i++) {
    const char = chars[i];
    if (char.rotation === 0) {
      values.push(char.rect[1]);
    } else if (char.rotation === 90) {
      values.push(char.rect[2]);
    } else if (char.rotation === 180) {
      values.push(char.rect[3]);
    } else if (char.rotation === 270) {
      values.push(char.rect[0]);
    }
  }
  return median(values);
}

function getLineTop(chars, line) {
  const values = [];
  for (let i = line.start; i <= line.end; i++) {
    const char = chars[i];
    if (char.rotation === 0) {
      values.push(char.rect[3]);
    } else if (char.rotation === 90) {
      values.push(char.rect[0]);
    } else if (char.rotation === 180) {
      values.push(char.rect[1]);
    } else if (char.rotation === 270) {
      values.push(char.rect[2]);
    }
  }
  return median(values);
}

function getBoundingRect(chars, line) {
  const lineChars = chars.slice(line.start, line.end + 1);
  return [
    Math.min(...lineChars.map(x => x.rect[0])),
    Math.min(...lineChars.map(x => x.rect[1])),
    Math.max(...lineChars.map(x => x.rect[2])),
    Math.max(...lineChars.map(x => x.rect[3])),
  ];
}

function mostCommonFontName(chars, line) {
  const fontCount = Object.create(null);

  // Match the legacy `chars.slice(line.start, line.end)` call, where `end`
  // was accidentally treated as exclusive.
  for (let i = line.start; i < line.end; i++) {
    const fontName = chars[i].fontName;
    fontCount[fontName] = (fontCount[fontName] || 0) + 1;
  }

  let mostCommonFont = null;
  let maxCount = 0;
  for (const fontName in fontCount) {
    if (fontCount[fontName] > maxCount) {
      maxCount = fontCount[fontName];
      mostCommonFont = fontName;
    }
  }

  return mostCommonFont;
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

function applyParagraphBreakAfterCompat(chars) {
  for (const char of chars) {
    delete char.paragraphBreakAfter;
  }

  if (!chars.length) {
    return chars;
  }

  const lines = getLines(chars);
  const lineSpacings = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const currentLineBottom = getLineBottom(chars, lines[i]);
    const nextLineTop = getLineTop(chars, lines[i + 1]);
    lineSpacings.push(currentLineBottom - nextLineTop);
  }

  const lineHeights = [];
  for (const line of lines) {
    const lineTop = getLineTop(chars, line);
    const lineBottom = getLineBottom(chars, line);
    lineHeights.push(lineTop - lineBottom);
  }

  const MAX_LINE_SPACING = 5;
  const MIN_LINE_SPACING = -2;
  const MAX_LINE_SPACING_CHANGE = 2;
  const isGapValid = gap => gap >= MIN_LINE_SPACING && gap <= MAX_LINE_SPACING;

  for (let i = 0; i < lines.length - 1; i++) {
    const currentLine = lines[i];
    const nextLine = lines[i + 1];
    const currentRect = getBoundingRect(chars, currentLine);
    const nextRect = getBoundingRect(chars, nextLine);
    const currentLineSpacing = lineSpacings[i];
    const nextLineSpacing = lineSpacings[i + 1];
    const currentLineHeight = lineHeights[i];
    const nextLineHeight = lineHeights[i + 1];

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

    const currentLineFontName = mostCommonFontName(chars, currentLine);
    const nextLineFontName = mostCommonFontName(chars, nextLine);
    if (
      !allowGap ||
      !(currentRect[1] > nextRect[3]) ||
      (currentLineFontName !== nextLineFontName &&
        currentRect[2] < nextRect[2] - 10) ||
      Math.abs(currentLineHeight - nextLineHeight) > 2
    ) {
      chars[currentLine.end].paragraphBreakAfter = true;
    }
  }

  chars.at(-1).paragraphBreakAfter = true;
  return chars;
}

export { applyParagraphBreakAfterCompat };

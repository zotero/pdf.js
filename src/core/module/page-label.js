import { getBoundingRect, getRectCenter } from './utilities.js';

function romanToInteger(str) {
  // Check if the string is empty or mixed case
  if (!str || str.length === 0 || (str !== str.toUpperCase() && str !== str.toLowerCase())) {
    return null; // Not a valid Roman numeral due to empty, mixed case, or non-string input
  }

  // Define Roman numeral values and subtractive pairs for validation
  const values = {I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000};
  // Normalize input to uppercase for consistent processing
  const input = str.toUpperCase();

  let total = 0;
  let prevValue = 0;

  for (let i = 0; i < input.length; i++) {
    const currentValue = values[input[i]];

    // Invalid character check
    if (currentValue === undefined) return null;

    // Main conversion logic with subtractive notation handling
    if (currentValue > prevValue) {
      // Subtract twice the previous value since it was added once before
      total += currentValue - 2 * prevValue;
    } else {
      total += currentValue;
    }

    prevValue = currentValue;
  }

  return total;
}

function extractLastInteger(str) {
  let numStr = '';
  let foundDigit = false;

  for (let i = str.length - 1; i >= 0; i--) {
    const char = str[i];
    if (char >= '0' && char <= '9') {
      numStr = char + numStr;
      foundDigit = true;
    } else if (foundDigit) {
      // Once a non-digit is encountered after finding at least one digit, break
      break;
    }
  }

  return foundDigit ? parseInt(numStr, 10) : null;
}

function parseCandidateNumber(str) {
  let type = 'arabic';
  let integer = extractLastInteger(str);
  if (!integer) {
    type = 'roman';
    integer = romanToInteger(str);
    if (!integer) {
      return null;
    }
  }
  return { type, integer };
}

function splitIntoWords(chars) {
  let words = [];
  let currentWordChars = [];
  let offsetFrom = 0; // Initialize offset from the first character

  for (let i = 0; i < chars.length; i++) {
    const charObj = chars[i];
    if (currentWordChars.length === 0) {
      // Update offsetFrom to current position when starting a new word
      offsetFrom = i;
    }
    currentWordChars.push(charObj);

    // Check for any type of break indicating the end of a word
    if (charObj.spaceAfter || charObj.lineBreakAfter || charObj.paragraphBreakAfter || i === chars.length - 1) {
      if (currentWordChars.length > 0) {
        // Include offsetFrom and calculate offsetTo for the current word
        words.push({
          chars: currentWordChars,
          offsetFrom: offsetFrom,
          offsetTo: i, // offsetTo is the current position
          rect: getBoundingRect(currentWordChars),
        });
        currentWordChars = []; // Reset for the next word
      }
    }
  }
  return words;
}

function getPageWords(chars, viewportRect) {
  let contentRect = getBoundingRect(chars);
  let contentCenter = getRectCenter(contentRect);
  let viewportCenter = getRectCenter(viewportRect);
  let words = splitIntoWords(chars);
  for (let word of words) {
    let wordCenter = getRectCenter(word.rect);
    let eps = 5;
    let deltaX = wordCenter[0] - viewportCenter[0];
    if (Math.abs(deltaX) < eps) {
      word.relativeX = deltaX;
    }
    else if (deltaX < 0) {
      word.relativeX = word.rect[0] - contentRect[0];
    }
    else {
      word.relativeX = contentRect[2] - word.rect[2];
    }

    if (wordCenter[1] < viewportCenter[1]) {
      word.relativeY = word.rect[1] - contentRect[1];
    }
    else {
      word.relativeY = contentRect[3] - word.rect[3];
    }

    if (word.offsetFrom > chars.length - word.offsetTo) {
      word.relativeOffset = word.offsetFrom;
    }
    else {
      word.relativeOffset = word.offsetTo;
    }
  }
  return words;
}

function getClusters(objects, property, eps) {
  // Sort objects based on the specified property
  objects.sort((a, b) => a[property] - b[property]);

  let clusters = [];
  let currentCluster = [objects[0]];

  for (let i = 1; i < objects.length; i++) {
    const object = objects[i];
    const distance = Math.abs(object[property] - currentCluster[currentCluster.length - 1][property]);

    // Add to current cluster if within eps; otherwise, start a new cluster
    if (distance <= eps) {
      currentCluster.push(object);
    } else {
      // Check for at least three unique pageIndexes before adding to clusters
      if (new Set(currentCluster.map(x => x.pageIndex)).size >= 3) {
        clusters.push(currentCluster);
      }
      currentCluster = [object];
    }
  }

  // Check the last cluster
  if (new Set(currentCluster.map(x => x.pageIndex)).size >= 3) {
    clusters.push(currentCluster);
  }

  return clusters;
}

function getLabelSequence(words) {
  words.sort((a, b) => a.integer - b.integer);

  let sequences = [];
  let currentSequence = [];

  for (let i = 0; i < words.length; i++) {
    let a = words[i];
    currentSequence = [a];
    for (let j = i + 1; j < words.length; j++) {
      let b = words[j];
      let prev = currentSequence.at(-1);
      if (b.pageIndex > prev.pageIndex && b.pageIndex - prev.pageIndex === b.integer - prev.integer) {
        currentSequence.push(b);
      }
    }
    if (currentSequence.length >= 3) {
      sequences.push(currentSequence);
    }
    currentSequence = [];
  }

  return sequences.sort((a, b) => b.length - a.length)[0];
}

export async function getPageLabel(pdfDocument, structuredCharsProvider, pageIndex, metadataPagesField) {
  const NEXT_PREV_PAGES = 2;
  let numPages = pdfDocument.catalog.numPages;
  let pageLabels = pdfDocument.catalog.pageLabels;
  let from = pageIndex - NEXT_PREV_PAGES;
  let to = pageIndex + NEXT_PREV_PAGES;
  if (from < 0) {
    to += -from;
    from = 0;
  }
  if (to >= numPages) {
    to = numPages - 1;
  }

  let candidateWords = [];
  for (let i = from; i <= to; i++) {
    let chars = await structuredCharsProvider(i);
    let page = await pdfDocument.getPage(i);
    let { view } = page;
    let words = getPageWords(chars, view);
    for (let word of words) {
      word.pageIndex = i;
      let candidateNumber = parseCandidateNumber(word.chars.map(x => x.c).join(''));
      if (candidateNumber) {
        word.type = candidateNumber.type;
        word.integer = candidateNumber.integer;
        candidateWords.push(word);
      }
    }
  }

  let yClusters = getClusters(candidateWords, 'relativeY', 5);

  let bestSequence = [];
  for (let yCluster of yClusters) {
    let clusters = getClusters(yCluster, 'relativeX', 5);
    for (let cluster of clusters) {
      let sequence = getLabelSequence(cluster);
      if (sequence && sequence.length > bestSequence) {
        bestSequence = sequence;
      }
    }
  }

  let data = bestSequence.find(x => x.pageIndex === pageIndex);
  if (data) {
    return data;
  }

  return null;
}

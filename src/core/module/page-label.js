import { getBoundingRect, getRectCenter } from './util.js';

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
  if (!objects.length) {
    return [];
  }
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

function getClusterMaxDistance(cluster, property) {
  let min = Math.min(...cluster.map(x => x[property]));
  let max = Math.max(...cluster.map(x => x[property]));
  return max - min;
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

  let eps = 5;

  let yClusters = getClusters(candidateWords, 'relativeY', eps);

  let bestSequence = [];
  for (let yCluster of yClusters) {
    let clusters = getClusters(yCluster, 'relativeX', eps);
    for (let cluster of clusters) {
      // Ignore clusters with too many values
      if (cluster.length > eps * 5) {
        continue;
      }
      let sequence = getLabelSequence(cluster);

      if (
        sequence &&
        sequence.length > bestSequence &&
        // Make sure the final sequence page label min and max distance doesn't surpass eps
        getClusterMaxDistance(sequence, 'relativeY') <= eps &&
        getClusterMaxDistance(sequence, 'relativeX') <= eps
      ) {
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


function arabicToRoman(num) {
  const romanKeys = {
    M: 1000,
    CM: 900,
    D: 500,
    CD: 400,
    C: 100,
    XC: 90,
    L: 50,
    XL: 40,
    X: 10,
    IX: 9,
    V: 5,
    IV: 4,
    I: 1
  };
  let roman = '';

  for (let key in romanKeys) {
    while (num >= romanKeys[key]) {
      roman += key;
      num -= romanKeys[key];
    }
  }

  return roman;
}

export function predictPageLabels(extractedPageLabels, catalogPageLabels, pagesCount) {
  let pageLabels = [];

  if (!catalogPageLabels && Object.values(extractedPageLabels).length < 2) {
    for (let i = 0; i < pagesCount; i++) {
      pageLabels[i] = (i + 1).toString();
    }
    return pageLabels;
  }

  for (let i = 0; i < pagesCount; i++) {
    pageLabels[i] = '-';
  }

  let allPageLabels = Object.values(extractedPageLabels).sort((a, b) => a.pageIndex - b.pageIndex);
  if (
    catalogPageLabels
    && catalogPageLabels.length === pagesCount
    && (
      allPageLabels[0] && catalogPageLabels[allPageLabels[0].pageIndex] === allPageLabels[0].chars.map(x => x.u).join('')
      || allPageLabels.length === 0
    )
  ) {
    for (let i = 0; i < pagesCount; i++) {
      pageLabels[i] = catalogPageLabels[i];
    }
  }

  let firstArabicPageLabel = Object.values(extractedPageLabels).filter(x => x.type === 'arabic')[0];

  if (firstArabicPageLabel) {
    let startInteger = firstArabicPageLabel.integer - firstArabicPageLabel.pageIndex;
    for (let i = 0; i < pagesCount; i++) {
      if (startInteger + i >= 1) {
        pageLabels[i] = (startInteger + i).toString();
      }
    }
  }
  return pageLabels;
}

export async function getPageLabels(pdfDocument, structuredCharsProvider) {
  let extractedLabels = {};
  for (let i = 0; i < 25; i++) {
    let pageLabel = await getPageLabel(pdfDocument, structuredCharsProvider, i);
    if (pageLabel) {
      extractedLabels[i] = pageLabel;
    }
  }

  let catalogPageLabels = await pdfDocument.pdfManager.ensureCatalog("pageLabels");

  let pageLabels = predictPageLabels(extractedLabels, catalogPageLabels, pdfDocument.catalog.numPages)

  return pageLabels;
}

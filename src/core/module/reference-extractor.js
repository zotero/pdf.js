import {
  getBoundingRect,
  getCenterRect,
  intersectRects,
  getClusters
} from './utilities.js';
import { getRegularLinkOverlays } from './link/link.js';

function removeASCIISymbolsAndNumbers(inputString) {
  let result = '';
  for (let i = 0; i < inputString.length; i++) {
    let charCode = inputString.charCodeAt(i);
    // Check if the character is a letter (either lowercase or uppercase)
    if ((charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122) || charCode >= 128) {
      result += inputString[i];
    }
  }
  return result;
}

function getReferencesTitleOffset(chars) {
  let titles = ['references', 'bibliography', 'literature', 'bibliographie'];

  let paragraphs = []; // This will hold the start and end indices of each paragraph
  let start = 0; // Start index of the current paragraph

  for (let i = 0; i < chars.length; i++) {
    if (chars[i].paragraphBreakAfter || i === chars.length - 1) {
      // If current char has .paragraphBreakAfter or it's the last element of the array
      let end = i + 1; // End index of the current paragraph
      paragraphs.push({ start: start, end: end });
      start = i + 1; // The next paragraph starts after the current one ends
    }
  }

  for (let paragraph of paragraphs) {
    let { start, end } = paragraph;
    let text = chars.slice(start, end).map(x => x.c).join('');
    text = text.toLowerCase();
    text = removeASCIISymbolsAndNumbers(text);
    for (let title of titles) {
      if (text.startsWith(title) || text.endsWith(title)) {
        return end;
      }
    }
  }
  return -1;
}

function splitIntoWords(chars) {
  let words = [];
  let currentWordChars = [];
  let isNewLine = true;
  let offsetFrom = 0;
  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];

    currentWordChars.push(char);

    if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter || i === chars.length - 1) {
      let charBeforeWord = chars[offsetFrom - 1];

      let number = currentWordChars.filter(char => char.c >= '0' && char.c <= '9').map(x => x.c);
      if ((charBeforeWord && (charBeforeWord.lineBreakAfter || charBeforeWord.paragraphBreakAfter) || !charBeforeWord)
        && number.length > 0 && number.length <= 3 && currentWordChars.length <= number.length + 2) {
        // Push the word object if it contains a number
        words.push({
          chars: currentWordChars.slice(), // Use slice to copy the array
          offsetFrom: offsetFrom,
          offsetTo: i, // The current character is part of the word
          rect: getBoundingRect(currentWordChars),
          distanceToNextChar: null,
          pageIndex: char.pageIndex,
          number: parseInt(number),
        });
      }
      currentWordChars = []; // Reset for the next word
      offsetFrom = i + 1;
    }
  }

  // Calculate the distance from the last number of the current word to the next character in chars
  for (let j = 0; j < words.length; j++) {
    const word = words[j];
    let lastNumberCharIndex = -1;

    // Find the last number in the word
    for (let k = word.chars.length - 1; k >= 0; k--) {
      if (word.chars[k].c >= '0' && word.chars[k].c <= '9') {
        lastNumberCharIndex = k;
        break;
      }
    }

    if (lastNumberCharIndex !== -1) {
      const lastNumberChar = word.chars[lastNumberCharIndex];
      let nextChar = chars[word.offsetTo + 1]; // Get the next character in the chars array after the current word

      if (nextChar) {
        // Calculate the distance using the rect properties
        words[j].distanceToNextChar = nextChar.rect[0] - lastNumberChar.rect[2];
        words[j].distanceToNextChar2 = nextChar.rect[0] - word.chars[0].rect[0];
      }
    }
  }

  return words;
}




function extractBySequence(chars) {
  // Filter words that have a white space before it and an extractable integer [1], 1.
  // Find the longest sequence?


  let words = splitIntoWords(chars);

  if (!words.length) {
    return [];
  }

  let clusters1 = getClusters(words, 'distanceToNextChar', 2);

  let cluster1 = clusters1.reduce((a, b) => a.length > b.length ? a : b, []);

  let clusters2 = getClusters(words, 'distanceToNextChar2', 2);

  let cluster2 = clusters2.reduce((a, b) => a.length > b.length ? a : b, []);

  if (cluster1.length > cluster2.length) {
    words = cluster1;
  }
  else {
    words = cluster2;
  }

  words.sort((a, b) => a.offsetFrom - b.offsetFrom);

  let lastPageIndex = words[0].pageIndex;


  let finalWords = [];

  let groupedChars = [];
  for (let i = 0; i < words.length; i++) {
    if (i < words.length - 1) {
      // Slice from the current word's offsetFrom to the next word's offsetFrom
      groupedChars.push(chars.slice(words[i].offsetFrom, words[i + 1].offsetFrom));
    } else {
      // For the last word, slice from its offsetFrom to the end of the chars array
      // And try to find paragraph end

      let chars2 = chars.slice(words[i].offsetFrom);
      let endIndex = chars2.findIndex(x => x.paragraphBreakAfter);
      chars2 = chars2.slice(0, endIndex + 1);
      groupedChars.push(chars2);
    }
  }

  let references = [];
  for (let chars of groupedChars) {
    let pageIndex = chars[0].pageIndex;
    let chars1 = [];
    let chars2 = [];
    for (let char of chars) {
      if (char.pageIndex === pageIndex) {
        chars1.push(char);
      } else {
        chars2.push(char);
      }
    }

    let position = {
      pageIndex,
      rects: [getBoundingRect(chars1)],
    };
    if (chars2.length) {
      position.nextPageRects = [getBoundingRect(chars2)];
    }

    let text = [];
    for (let char of chars) {
      text.push(char.c);
      if (char.spaceAfter) {
        text.push(' ');
      }
    }
    text = text.join('');

    let result = text.match(/\d+/);
    let index = result ? parseInt(result[0], 10) : null;

    let reference = {
      text,
      chars,
      position
    };

    if (index) {
      reference.index = index;
    }

    references.push(reference);
  }

  return references;
}

function extractByLayout(chars) {
  let lines = [];
  let currentLineChars = [];
  let offsetFrom = 0;
  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];
    currentLineChars.push(char);
    if (char.lineBreakAfter) {
      lines.push({
        chars: currentLineChars,
        offsetFrom,
        offsetTo: i,
        rect: getBoundingRect(currentLineChars),
      });
      offsetFrom = i + 1;
      currentLineChars = [];
    }
  }


  let deltas = [];
  for (let i = 1; i < lines.length; i++) {
    let prevLine = lines[i - 1];
    let line = lines[i];

    let delta = line.rect[0] - prevLine.rect[0];
    if (delta > 5) {
      deltas.push({
        offset: prevLine.offsetFrom,
        delta,
      });
    }
  }

  let clusters = getClusters(deltas, 'delta', 1);

  let paragraphBreaks = clusters[0];

  // Extracting by layout depends on first line of each reference being shifted more on the left
  // than other lines. But some lines can fit in a single line therefore the paragraph
  // break before that line won't be added.
  // Therefore, we try to detect first characters of each line that align with
  // other reference beginnings
  let extraParagraphBreaks = [];
  let breakers = paragraphBreaks.map(x => ({ x: chars[x.offset].rect[0] }));
  let breakClusters = getClusters(breakers, 'x', 1);
  let breakPoints = breakClusters.map(x => x[0].x);
  let paragraphBreakSet = new Set(paragraphBreaks.map(x => x.offset));
  for (let i = 0; i < chars.length; i++) {
    let prevChar = chars[i-1];
    let char = chars[i];
    if ((!prevChar || prevChar.rect[0] > char.rect[0]) &&
      !paragraphBreakSet.has(i) && breakPoints.some(x => Math.abs(x - char.rect[0]) < 1)) {
      extraParagraphBreaks.push({ offset: i });
    }
  }
  // For now make sure that extra breaks are no more than 20%
  if (extraParagraphBreaks.length / paragraphBreaks.length <= 0.2) {
    paragraphBreaks.push(...extraParagraphBreaks);
  }

  paragraphBreaks.sort((a, b) => a.offset - b.offset);

  let groupedChars = [];
  for (let i = 0; i < paragraphBreaks.length; i++) {
    if (i < paragraphBreaks.length - 1) {
      // Slice from the current word's offsetFrom to the next word's offsetFrom
      groupedChars.push(chars.slice(paragraphBreaks[i].offset, paragraphBreaks[i + 1].offset));
    } else {
      // For the last word, slice from its offsetFrom to the end of the chars array
      // And try to find paragraph end

      let chars2 = chars.slice(paragraphBreaks[i].offset);
      groupedChars.push(chars2);
    }
  }

  groupedChars = groupedChars.filter(x => x.length)

  let references = [];
  for (let chars of groupedChars) {
    let pageIndex = chars[0].pageIndex;
    let chars1 = [];
    let chars2 = [];
    for (let char of chars) {
      if (char.pageIndex === pageIndex) {
        chars1.push(char);
      } else {
        chars2.push(char);
      }
    }

    let position = {
      pageIndex,
      rects: [getBoundingRect(chars1)],
    };
    if (chars2.length) {
      position.nextPageRects = [getBoundingRect(chars2)];
    }

    let text = [];
    for (let char of chars) {
      text.push(char.c);
      if (char.spaceAfter) {
        text.push(' ');
      }
    }
    text = text.join('');

    references.push({
      text,
      chars,
      position
    });
  }

  return references
}

function extractByParagraphSpacing(chars) {
  let lines = [];
  let currentLineChars = [];
  let offsetFrom = 0;
  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];
    currentLineChars.push(char);
    if (char.lineBreakAfter) {
      lines.push({
        chars: currentLineChars,
        offsetFrom,
        offsetTo: i,
        rect: getBoundingRect(currentLineChars),
      });
      offsetFrom = i + 1;
      currentLineChars = [];
    }
  }

  let spacings = [];
  for (let i = 1; i < lines.length; i++) {
    let prevLine = lines[i - 1];
    let line = lines[i];

    let spacing = prevLine.rect[1] - line.rect[3];
    if (spacing > 0) {
      spacings.push({
        offset: line.offsetFrom,
        spacing,
      });
    }
  }

  let clusters = getClusters(spacings, 'spacing', 0.5);

  let values = clusters[0].map(x => x.spacing);

  let average = values.reduce((acc, val) => acc + val, 0) / values.length;

  let paragraphBreaks = spacings.filter(x => x.spacing > average + 1);

  if (!paragraphBreaks.length) {
    return [];
  }

  // Put chars before the first paragraph break
  let groupedChars = [chars.slice(0, paragraphBreaks[0].offset)];
  for (let i = 0; i < paragraphBreaks.length; i++) {
    if (i < paragraphBreaks.length - 1) {
      // Slice from the current word's offsetFrom to the next word's offsetFrom
      groupedChars.push(chars.slice(paragraphBreaks[i].offset, paragraphBreaks[i + 1].offset));
    } else {
      // For the last word, slice from its offsetFrom to the end of the chars array
      // And try to find paragraph end

      let chars2 = chars.slice(paragraphBreaks[i].offset);

      groupedChars.push(chars2);
    }
  }

  let references = [];
  for (let chars of groupedChars) {
    let pageIndex = chars[0].pageIndex;
    let chars1 = [];
    let chars2 = [];
    for (let char of chars) {
      if (char.pageIndex === pageIndex) {
        chars1.push(char);
      } else {
        chars2.push(char);
      }
    }

    let position = {
      pageIndex,
      rects: [getBoundingRect(chars1)],
    };
    if (chars2.length) {
      position.nextPageRects = [getBoundingRect(chars2)];
    }

    let text = [];
    for (let char of chars) {
      text.push(char.c);
      if (char.spaceAfter) {
        text.push(' ');
      }
    }
    text = text.join('');

    references.push({
      text,
      chars,
      position
    });
  }

  let lowerCaseNum = 0;

  for (let reference of references) {
    if (reference.text[0] === reference.text[0].toLowerCase()) {
      lowerCaseNum++;
    }
  }

  if (lowerCaseNum >= 5) {
    return [];
  }

  return references;
}

// TODO: In Mills - 2015 some lines a single therefore they won't be break.
//  Fix that. Use line that aligns other reference start and break everything else that is next to this line

export async function extractReferences(pdfDocument, structuredCharsProvider) {
  let pagesProcessed = 0;

  let refPageIdx = null;
  let refPageOffset = null;
  for (let i = pdfDocument.catalog.numPages - 1; i >= 0 && pagesProcessed <= 10; i--) {
    let chars = await structuredCharsProvider(i);

    // Clone chars because we are modifying (pageIndex, url) them
    chars = chars.map(char => ({ ...char }));

    let offset = getReferencesTitleOffset(chars);
    if (offset !== -1 ) {
      refPageIdx = i;
      refPageOffset = offset;
      break;
    }
    pagesProcessed++;
  }

  if (refPageIdx !== null) {
    const MAX_REF_PAGES = 10;
    let combinedChars = [];
    for (let i = refPageIdx; i < refPageIdx + MAX_REF_PAGES && i < pdfDocument.catalog.numPages; i++) {
      let chars = await structuredCharsProvider(i);
      for (let char of chars) {
        char.pageIndex = i;
      }
      if (i === refPageIdx) {
        chars = chars.slice(refPageOffset);
      }
      combinedChars.push(...chars);
    }

    combinedChars = combinedChars.filter(x => !x.isolated);

    let groups = [
      extractBySequence(combinedChars),
      extractByParagraphSpacing(combinedChars),
      extractByLayout(combinedChars),
    ];

    let bestGroup = null;
    for (let group of groups) {
      if (bestGroup === null || bestGroup.length < group.length) {
        bestGroup = group;
      }
    }

    let references = bestGroup;

    // await getPageReferences(structuredCharsProvider, 0, pdfDocument.catalog.numPages, references);

    await addUrls(pdfDocument, structuredCharsProvider, references);


    let start = { pageIndex: refPageIdx, offset: refPageOffset };

    return { references, start };
  }
}

async function addUrls(pdfDocument, structuredCharsProvider, references) {
  let allPageIndexes = references.map(x => x.position.pageIndex);
  let minPageIndex = Math.min(...allPageIndexes);
  let maxPageIndex = Math.max(...allPageIndexes);
  for (let i = minPageIndex; i <= maxPageIndex; i++) {
    let linkOverlays = await getRegularLinkOverlays(pdfDocument, structuredCharsProvider, i);
    linkOverlays = linkOverlays.filter(x => x.type === 'external-link');
    for (let linkOverlay of linkOverlays) {
      let { rects } = linkOverlay.position;
      for (let reference of references) {
        for (let char of reference.chars) {
          if (char.pageIndex === linkOverlay.position.pageIndex) {
            for (let rect of rects) {
              let centerRect = getCenterRect(char.rect);
              if (intersectRects(centerRect, rect)) {
                char.url = linkOverlay.url;
              }
            }
          }
        }
      }
    }
  }
}

import { getBoundingRect, getClusters } from '../../util.js';
import {
  getGroupsFromClusters,
  getReferencesFromGroup,
  splitByPageIndexContinuity,
} from './common.js';

function getBreakPoints(chars, sectionOffset) {
  let breakPoints = [];
  let currentWordChars = [];
  let isNewLine = true;
  let offsetFrom = sectionOffset;

  for (let i = offsetFrom; i < chars.length; i++) {
    let char = chars[i];

    currentWordChars.push(char);

    if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter || i === chars.length - 1) {
      let charBeforeWord = chars[offsetFrom - 1];
      let charAfterWord = chars[offsetFrom + currentWordChars.length];
      let charLast = currentWordChars.at(-1);

      let number = currentWordChars.filter(char => char.c >= '0' && char.c <= '9').map(x => x.c);
      if (
        (
          charBeforeWord && (charBeforeWord.lineBreakAfter || charBeforeWord.paragraphBreakAfter)
          || !charBeforeWord
        ) &&
        (
          !charLast.lineBreakAfter
        )
        && (currentWordChars[0].c !== '(' || currentWordChars.at(-1).c === ')')
        && (currentWordChars[0].c !== '[' || currentWordChars.at(-1).c === ']')
        && (currentWordChars.at(-1).c !== ')' || currentWordChars[0].c === '(')
        && (currentWordChars.at(-1).c !== ']' || currentWordChars[0].c === '[')
        && !currentWordChars.some(x => !['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '(', ')', '[', ']', '.', ':'].includes(x.c))
        // && charAfterWord.c === charAfterWord.c.toUpperCase()
        && number.length > 0 && number.length <= 3 && currentWordChars.length <= number.length + 2) {
        // Push the word object if it contains a number
        breakPoints.push({
          text: currentWordChars.map(x => x.c).join(''),
          chars: currentWordChars.slice(), // Use slice to copy the array
          offset: offsetFrom,
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
  for (let j = 0; j < breakPoints.length; j++) {
    const word = breakPoints[j];
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
      let nextChar = chars[word.offset + word.chars.length]; // Get the next character in the chars array after the current word

      if (nextChar) {
        // Calculate the distance using the rect properties
        breakPoints[j].distanceToNextChar = nextChar.rect[0] - lastNumberChar.rect[2];
        breakPoints[j].distanceToNextChar2 = nextChar.rect[0] - word.chars[0].rect[0];
      }
    }
  }

  return breakPoints;
}

export async function extractByListNumberSpacing(chars, sectionOffset) {
  // Filter words that have a white space before it and an extractable integer [1], 1.
  // Find the longest sequence?
  let breakPoints = getBreakPoints(chars, sectionOffset);
  if (!breakPoints.length) {
    return null;
  }
  let clusters1 = getClusters(breakPoints, 'distanceToNextChar', 1);
  let clusters2 = getClusters(breakPoints, 'distanceToNextChar2', 1);
  let clusters = [...clusters1, ...clusters2];
  clusters.forEach(x => x.sort((a, b) => a.offset - b.offset));
  clusters = splitByPageIndexContinuity(clusters);
  let groups = getGroupsFromClusters(chars, clusters);
  if (!sectionOffset) {
    groups = groups.filter(x => (chars[x[0].offset].pageIndex + 1) / (chars.at(-1).pageIndex + 1) >= 0.75);
  }

  if (groups.length === 0) {
    return null;
  }

  let group = groups.reduce((a, b) => a.length > b.length ? a : b, []);

  let references = getReferencesFromGroup(group, true);
  let offset = group[0].offset;
  return { references, offset };
}

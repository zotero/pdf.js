import { getSortIndex } from '../util.js';

let labels = [
  ['figure', 'fig'],
  ['photograph', 'photo'],
  ['illustration', 'illus'],
  ['table', 'tbl'],
  ['equation', 'eq'],
  ['example', 'ex']
];

function getBoundingRect(chars) {
  return [
    Math.min(...chars.map(x => x.rect[0])),
    Math.min(...chars.map(x => x.rect[1])),
    Math.max(...chars.map(x => x.rect[2])),
    Math.max(...chars.map(x => x.rect[3])),
  ];
}

function trimNonNumbers(str) {
  return str.replace(/^\D+|\D+$/g, '');
}

function trimNonLettersUsingCase(str) {
  let start = 0;
  let end = str.length - 1;
  // Trim from the start
  while (start <= end && str[start].toLowerCase() === str[start].toUpperCase()) {
    start++;
  }
  // Trim from the end
  while (end >= start && str[end].toLowerCase() === str[end].toUpperCase()) {
    end--;
  }
  // Slice the string to get only the part with letters at the start and end
  return str.slice(start, end + 1);
}

function getCharDistanceMinHorizontalOrVertical(a, b) {
  // Extract the coordinates of rectangles a and b
  const [ax1, ay1, ax2, ay2] = a.rect;
  const [bx1, by1, bx2, by2] = b.rect;

  // Calculate the shortest x distance between rectangles a and b
  let xDistance = 0;
  if (ax2 < bx1) {
    xDistance = bx1 - ax2; // a is to the left of b
  } else if (bx2 < ax1) {
    xDistance = ax1 - bx2; // b is to the left of a
  }

  // Calculate the shortest y distance between rectangles a and b
  let yDistance = 0;
  if (ay2 < by1) {
    yDistance = by1 - ay2; // a is above b
  } else if (by2 < ay1) {
    yDistance = ay1 - by2; // b is above a
  }

  // Return the smaller of the two distances
  return Math.min(xDistance, yDistance);
}

function getCandidates(chars, pageIndex) {
  let words = [];
  let currentWordChars = [];
  let offsetFrom = 0;
  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];

    currentWordChars.push(char);

    if (
      char.spaceAfter ||
      char.lineBreakAfter ||
      char.paragraphBreakAfter ||
      char.c === ')' ||
      i === chars.length - 1
    ) {
      words.push({
        chars: currentWordChars.slice(),
        offsetFrom: offsetFrom,
        offsetTo: i,
      });

      currentWordChars = []; // Reset for the next word
      offsetFrom = i + 1;
    }
  }

  let candidates = [];

  for (let i = 0; i < words.length; i++) {
    let prevWord = words[i - 1];
    let word = words[i];

    let id;
    if (
      // If starts with a number. Examples: 123, 123)
      prevWord && '0' <= chars[word.offsetFrom].c && chars[word.offsetFrom].c <= '9' ||
      // If starts with '(', it has to end with ')' as well
      chars[word.offsetFrom].c === '(' && chars[word.offsetTo].c === ')' &&
      // and has at least one number within
      '0' <= chars[word.offsetFrom + 1].c && chars[word.offsetFrom + 1].c <= '9'
    ) {
      id = word.chars.slice();
    }
    else {
      continue;
    }

    let parenthesses = chars[word.offsetFrom].c === '(';

    id = id.map(x => x.c).join('');
    id = trimNonNumbers(id);

    if (id) {
      let candidate = {
        id,
        parenthesses,
        offsetFrom: word.offsetFrom,
        offsetTo: word.offsetTo,
        pageIndex,
      };


      if (prevWord) {
        // Get all letters that can be upper and lower case
        // TODO: Figure out what to do with non latin languages
        let label = prevWord.chars.map(x => x.c).join('');
        label = trimNonLettersUsingCase(label);
        // First letter is uppercase and there are at least two characters
        if (label && label[0].toUpperCase() === label[0] &&
          label.length >= 3 &&
          getCharDistanceMinHorizontalOrVertical(prevWord.chars.at(-1), word.chars[0]) < 10
        ) {
          candidate.label = label;
          candidate.offsetFrom = prevWord.offsetFrom;
        }
      }

      if (
        candidate.offsetFrom === 0 ||
        getCharDistanceMinHorizontalOrVertical(chars[candidate.offsetFrom - 1], chars[candidate.offsetFrom]) < 10
      ) {
        if (candidate.label) {
          candidate.src = true;
          candidates.push(candidate);
        }
      } else {
        if (candidate.label || candidate.parenthesses)
          candidate.dest = true;
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function matchCandidates(candidates, pageIndex) {
  let matches = [];
  let sources = candidates.filter(x => x.src && x.pageIndex === pageIndex);
  let destinations = new Map();
  for (let candidate of candidates) {
    if (candidate.dest) {
      let key = (candidate.label ? candidate.label + ' ' : '') + candidate.id;
      let list = destinations.get(key);
      if (!list) {
        list = [];
        destinations.set(key, list);
      }
      list.push(candidate);
    }
  }

  for (let source of sources) {
    let key = (source.label ? source.label + ' ' : '') + source.id;
    let destination = destinations.get(key);
    if (destination && destination.length === 1) {
      matches.push({
        source,
        destination: destination[0],
      });
    }
  }

  return matches;
}

export async function getMatchedOverlays(pdfDocument, structuredCharsProvider, pageIndex, annotationOverlays, contentRect) {
  let MAX_PAGES_AROUND = 5;
  let from = Math.max(pageIndex - MAX_PAGES_AROUND, 0);
  let to = Math.min(pageIndex + MAX_PAGES_AROUND, pdfDocument.catalog.numPages - 1);
  // from = to = pageIndex;
  let allCandidates = [];
  let pages = {};
  for (let i = from; i <= to; i++) {
    pages[i] = await structuredCharsProvider(i);
    let candidates = getCandidates(pages[i], i);
    allCandidates.push(...candidates);
  }

  let matches = matchCandidates(allCandidates, pageIndex);

  let overlays = [];
  for (let match of matches) {
    let sourceChars = pages[match.source.pageIndex].slice(match.source.offsetFrom, match.source.offsetTo + 1);
    let sourceRect = getBoundingRect(sourceChars);

    let destinationChars = pages[match.destination.pageIndex].slice(match.destination.offsetFrom, match.destination.offsetTo + 1);
    let destinationRect = getBoundingRect(destinationChars);
    // destinationRect[2] = destinationRect[0];
    // destinationRect[1] = destinationRect[3];

    let overlay = {
      type: 'internal-link',
      source: 'matched',
      sortIndex: getSortIndex(match.source.pageIndex, match.source.offsetFrom, 0),
      position: {
        pageIndex: match.source.pageIndex,
        rects: [sourceRect],
      },
      destinationPosition: {
        pageIndex: match.destination.pageIndex,
        rects: [destinationRect],
      },
    };

    overlays.push(overlay);
  }

  return overlays;
}

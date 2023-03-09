import { getSortIndex } from '../utilities.js';

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

function getDist(a, b) {
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
          label.length >= 2 &&
          getDist(prevWord.chars.at(-1), word.chars[0]) < 10
        ) {
          candidate.label = label;
          candidate.offsetFrom = prevWord.offsetFrom;
        }
      }

      if (
        candidate.offsetFrom === 0 ||
        getDist(chars[candidate.offsetFrom - 1], chars[candidate.offsetFrom]) < 10
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

function expandRect(currentRect, otherRects, surroundingRect) {
  let [x1, y1, x2, y2] = currentRect;
  let collision = { top: false, bottom: false, left: false, right: false };

  function intersects(rectA, rectB) {
    return rectA[0] < rectB[2] && rectA[2] > rectB[0] && rectA[1] < rectB[3] && rectA[3] > rectB[1];
  }

  while (!collision.top || !collision.bottom || !collision.left || !collision.right) {
    if (!collision.top && y1 > surroundingRect[1]) {
      y1 -= Math.min(10, y1 - surroundingRect[1]);
      if (otherRects.some(rect => intersects([x1, y1, x2, y2], rect))) {
        y1 += Math.min(10, y1 - surroundingRect[1]); // Revert if collision
        collision.top = true;
      }
    } else {
      collision.top = true;
    }

    if (!collision.bottom && y2 < surroundingRect[3]) {
      y2 += Math.min(10, surroundingRect[3] - y2);
      if (otherRects.some(rect => intersects([x1, y1, x2, y2], rect))) {
        y2 -= Math.min(10, surroundingRect[3] - y2); // Revert if collision
        collision.bottom = true;
      }
    } else {
      collision.bottom = true;
    }

    if (!collision.left && x1 > surroundingRect[0]) {
      x1 -= Math.min(10, x1 - surroundingRect[0]);
      if (otherRects.some(rect => intersects([x1, y1, x2, y2], rect))) {
        x1 += Math.min(10, x1 - surroundingRect[0]); // Revert if collision
        collision.left = true;
      }
    } else {
      collision.left = true;
    }

    if (!collision.right && x2 < surroundingRect[2]) {
      x2 += Math.min(10, surroundingRect[2] - x2);
      if (otherRects.some(rect => intersects([x1, y1, x2, y2], rect))) {
        x2 -= Math.min(10, surroundingRect[2] - x2); // Revert if collision
        collision.right = true;
      }
    } else {
      collision.right = true;
    }
  }

  return [x1, y1, x2, y2];
}

function getRect(destination, chars, contentRect) {
  let paragraph = { from: destination.offsetFrom, to: destination.offsetTo };

  while (chars[paragraph.from - 1] && !chars[paragraph.from - 1].paragraphBreakAfter) {
    paragraph.from--;
  }

  while (!chars[paragraph.to].paragraphBreakAfter) {
    paragraph.to++;
  }

  let rect = getBoundingRect(chars.slice(paragraph.from, paragraph.to + 1));




  let paragraphs = []; // This will hold the start and end indices of each paragraph
  let start = 0; // Start index of the current paragraph

  for (let i = 0; i < chars.length; i++) {
    if (chars[i].paragraphBreakAfter || i === chars.length - 1) {
      // If current char has .paragraphBreakAfter or it's the last element of the array
      let end = i; // End index of the current paragraph

      let rect = getBoundingRect(chars.slice(start, end + 1));

      let sumParagraph = (rect[2] - rect[0]) * (rect[3] - rect[1]);

      let sumLines = 0;

      let linesNum = 0;
      let lineStart = start;
      for (let k = start; k <= end; k++) {
        if (chars[k].lineBreakAfter) {
          let lineEnd = k + 1;
          let rect = getBoundingRect(chars.slice(lineStart, lineEnd));
          // console.log('uuu', chars.slice(lineStart, lineEnd).map(x => x.c).join(''), rect[2] - rect[0]);
          sumLines += (rect[2] - rect[0]) * (rect[3] - rect[1]);
          linesNum++;
          lineStart = k + 1;
        }
      }

      let sum = 0;
      for (let j = start; j <= end; j++) {
        let char = chars[j];
        sum += (char.rect[2] - char.rect[0]) * (char.rect[3] - char.rect[1]);
      }

      let densityRatio = sum / sumLines;
      if (end - start > 50 && densityRatio > 0.8 && linesNum >= 2 && !(paragraph.from>=start && paragraph.from <=end)) {
        paragraphs.push({
          start: start,
          end: end,
          densityRatio,
          rect,
          text: chars.slice(start, end + 1).map(x => x.c).join('')
        });
      }



      start = i + 1; // The next paragraph starts after the current one ends
    }
  }

  let rects = paragraphs.map(x => x.rect);

  let expandedRect = expandRect(rect, rects, [0, 0, 595.276, 790.866]);

  return expandedRect;
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

  for (let match of matches) {
    let destination = match.destination;
    destination.rect = getRect(destination, pages[destination.pageIndex], contentRect);
  }

  let overlays = [];
  for (let match of matches) {
    let sourceChars = pages[match.source.pageIndex].slice(match.source.offsetFrom, match.source.offsetTo + 1);
    let sourceRect = getBoundingRect(sourceChars);

    let destinationChars = pages[match.destination.pageIndex].slice(match.destination.offsetFrom, match.destination.offsetTo + 1);
    let destinationRect = getBoundingRect(destinationChars);

    let previewRect = match.destination.rect;
    previewRect = [
      Math.max(previewRect[0], contentRect[0]),
      Math.max(previewRect[1], contentRect[1]),
      Math.min(previewRect[2], contentRect[2]),
      Math.min(previewRect[3], contentRect[3]),
    ];

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
      previewPosition: {
        pageIndex: match.destination.pageIndex,
        rects: [previewRect],
      },
    };

    overlays.push(overlay);
  }

  return overlays;
}

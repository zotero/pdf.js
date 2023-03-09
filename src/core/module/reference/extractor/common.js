import { getBoundingRect, getClusters } from '../../util.js';

export function splitByPageIndexContinuity(clusters) {
  let newClusters = [];
  for (let i = 0; i < clusters.length; i++) {
    let cluster = clusters[i];
    let newCluster = [];
    for (let j = 0; j < cluster.length; j++) {
      let previousItem = cluster[j - 1];
      let item = cluster[j];
      if (previousItem && item.pageIndex - previousItem.pageIndex > 1) {
        newClusters.push(newCluster);
        newCluster = [];
      }
      newCluster.push(item);
    }
    newClusters.push(newCluster);
  }
  return newClusters;
}

export function hasValidYear(chars) {
  // Convert array of objects to a string of characters
  let text = chars.map(x => x.c).join('');
  let numbers = (text.match(/\d+/g) || []).map(x => parseInt(x));

  for (let number of numbers) {
    if (number >= 1800 && number <= new Date().getFullYear()) {
      return true;
    }
  }
  return false;
}

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

function isASCIISymbolOrNumber(char) {
  let charCode = char.charCodeAt(0);
  return charCode < 65 || (90 < charCode && charCode < 97) || charCode > 122;
}

export function canStartWithChar(char) {
  return (
    !isASCIISymbolOrNumber(char.c) &&
    // Is uppercase, if has an uppercase version (not the case for Asian languages)
    char.c === char.c.toUpperCase()
  );
}

export function getReferencesTitleOffset(chars) {
  let titles = ['references', 'bibliography', 'literature', 'bibliographie', 'literatur'];
  let paragraphs = [];
  let start = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].paragraphBreakAfter || i === chars.length - 1 /*|| chars[i].lineBreakAfter && Math.abs(chars[i].fontSize - chars[i+1].fontSize) > 0.1*/) {
      paragraphs.push({ start: start, end: i, text: chars.slice(start, i + 1).map(x => x.c).join('') });
      start = i + 1;
    }
  }
  let results = [];
  for (let paragraph of paragraphs) {
    let { start, end } = paragraph;
    if (end - start > 30 || chars.length - end < 300) {
      continue;
    }
    let text = chars.slice(start, end + 1).map(x => x.c).join('');
    text = text.toLowerCase();
    text = removeASCIISymbolsAndNumbers(text);
    for (let title of titles) {
      if (text.startsWith(title)) {
        results.push({ end, text, fontSize: chars[start].fontSize})
      }
      else if (text.endsWith(title)) {
        results.push({ end, text, fontSize: chars[end].fontSize})
      }
    }
  }
  let clusters = getClusters(results, 'fontSize', 0.1);
  let cluster = clusters.reduce((a, b) => a.fontSize > b.fontSize ? a : b, []);
  if (cluster.length === 1) {
    let result = cluster[0];
    let pagesCount = chars.at(-1).pageIndex + 1;
    let pos = (chars[result.end].pageIndex + 1) / pagesCount;
    if (pos >= 0.5) {
      return result.end + 1;
    }
  }
  return 0;
}

export function getGroupsFromClusters(chars, clusters) {
  let groups = [];
  for (let cluster of clusters) {
    let breakPoints = cluster;
    if (!breakPoints.length) {
      continue;
    }
    let group = [];
    for (let i = 0; i < breakPoints.length; i++) {
      let breakPoint = breakPoints[i];
      let chars2;
      if (i < breakPoints.length - 1) {
        chars2 = chars.slice(breakPoint.offset, breakPoints[i + 1].offset);
      } else {
        let finalBreak = breakPoint.offset;
        for (let j = finalBreak; j < chars.length; j++) {
          finalBreak = j;
          if (chars[j].paragraphBreakAfter) {
            break;
          }
        }
        chars2 = chars.slice(breakPoint.offset, finalBreak + 1);
      }
      group.push({
        valid: hasValidYear(chars2) && chars2.length > 50 && chars2.length < 1000 && chars2[0].pageIndex === chars2.at(-1).pageIndex,
        chars: chars2,
        text: chars2.map(x => x.c).join(''),
        pageIndex: chars2[0].pageIndex,
        offset: breakPoint.offset,
        spacing: breakPoint.spacing,
        delta: breakPoint.delta,
      });
    }

    groups.push(group);
  }
  return groups;
}

export function getReferencesFromGroup(group, useIndex) {
  let references = [];
  for (let { chars } of group) {
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

    let reference = {
      text,
      chars,
      position
    };

    if (useIndex) {
      let result = text.match(/\d+/);
      let index = result ? parseInt(result[0], 10) : null;

      if (index) {
        reference.index = index;
      }
    }
    references.push(reference);
  }
  return references;
}

export function getLinesFromChars(chars) {
  let lines = [];
  let currentLineChars = [];
  let offsetFrom = 0;
  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];
    currentLineChars.push(char);
    if (char.lineBreakAfter) {
      lines.push({
        chars: currentLineChars,
        offset: offsetFrom,
        rect: getBoundingRect(currentLineChars),
        pageIndex: char.pageIndex,
      });
      offsetFrom = i + 1;
      currentLineChars = [];
    }
  }
  return lines;
}



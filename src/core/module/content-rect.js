import { distance } from './lib/levenstein.js';
import { getCenterRect, getClusters, intersectRects } from './util.js';

// TODO: Take into account horizontal pages

function getLinesFromChars(chars, view) {
  let lines = [];
  let line = null;
  for (let char of chars) {
    if (line) {
      line.rect[0] = Math.min(line.rect[0], char.rect[0]);
      line.rect[1] = Math.min(line.rect[1], char.rect[1]);
      line.rect[2] = Math.max(line.rect[2], char.rect[2]);
      line.rect[3] = Math.max(line.rect[3], char.rect[3]);
      line.chars.push(char);
    } else {
      line = {
        rect: char.rect.slice(),
        chars: [char],
      };
    }
    if (char.lineBreakAfter) {
      lines.push(line);
      line = null;
    }
  }

  for (let line of lines) {
    let [x, y] = getCenterRect(line.rect);
    line.pageIndex = line.chars[0].pageIndex;
    line.text = line.chars.map(x => x.c).join('');
    // line.centerX = x - view[0];
    line.centerY = y - view[1];
  }
  return lines;
}

function getPageSizeIntervals(pages) {
  let intervals = [];
  let currentInterval = [];

  for (let i = 0; i < pages.length; i++) {
    let { view } = pages[i];
    let width = view[2] - view[0];
    let height = view[3] - view[1];

    if (currentInterval.length === 0) {
      currentInterval.push(i);
    } else {
      let lastPageIndex = currentInterval[currentInterval.length - 1];
      let { view: lastView } = pages[lastPageIndex];
      let lastWidth = lastView[2] - lastView[0];
      let lastHeight = lastView[3] - lastView[1];

      if (width === lastWidth && height === lastHeight) {
        currentInterval.push(i);
      } else {
        intervals.push(currentInterval);
        currentInterval = [i];
      }
    }
  }

  if (currentInterval.length > 0) {
    intervals.push(currentInterval);
  }

  return intervals;
}

export async function getContentRects(pdfDocument, structuredCharsProvider, pageLabels) {
  let contentRects = [];
  let { numPages } = pdfDocument.catalog;

  let pages = [];
  for (let i = 0; i < numPages; i++) {
    let page = await pdfDocument.getPage(i);
    pages.push(page);
  }

  for (let i = 0; i < numPages; i++) {
    let { view } = pages[i];
    contentRects.push(view.slice());
  }

  if (numPages > 100) {
    return contentRects;
  }

  let intervals = getPageSizeIntervals(pages);

  let maxInterval = intervals.reduce((a, b) => a.length > b.length ? a : b);

  if (intervals.length > 3) {
    return contentRects;
  }

  let pageLines = [];

  for (let i = 0; i < numPages; i++) {
    let { view } = pages[i];
    let chars = await structuredCharsProvider(i);
    let lines = getLinesFromChars(chars, view);
    pageLines.push(lines);
  }

  for (let i = 0; i < numPages; i++) {
    let pageIndex = i;
    let startPage = Math.max(pageIndex - 2, 0);
    let endPage = Math.min(pageIndex + 2, numPages - 1);

    let combinedLines = [];
    for (let i = startPage; i <= endPage; i++) {
      let lines = pageLines[i];
      combinedLines.push(...lines);
    }

    let clusters = getClusters(combinedLines, 'centerY', 0.2);
    let removeLines = new Set();

    for (let cluster of clusters) {
      if (cluster.length < 2 || cluster.length > 10) {
        continue;
      }
      for (let i = 0; i < cluster.length; i++) {
        let currentLine = cluster[i];
        if (currentLine.pageIndex !== pageIndex) {
          continue;
        }
        for (let j = 0; j < cluster.length; j++) {
          let otherLine = cluster[j];
          if (otherLine.pageIndex === pageIndex) {
            continue;
          }
          let min = Math.min(currentLine.text.length, otherLine.text.length);
          let max = Math.max(currentLine.text.length, otherLine.text.length);
          if (i === j || removeLines.has(currentLine) || (max - min) / max > 0.2) {
            continue;
          }
          let dist = distance(currentLine.text, otherLine.text);
          let stringsEqual = dist / currentLine.text.length <= 0.2;
          if (stringsEqual) {
            removeLines.add(currentLine);
          }
        }
      }
    }

    let currentPageLines = [];
    for (let line of combinedLines) {
      let pageLabel = pageLabels[pageIndex];


      if (
        !removeLines.has(line) &&
        line.pageIndex === pageIndex &&
        // Exclude lines that contain current page label. This can definitely lead to many
        // false positives, but most of them are compensated by the final bounding rect calculation,
        // which means if false positive is anywhere between other lines, the false positives won't have
        // any effect
        !(line.text === pageLabel || pageLabel.length >= 2 && line.text.includes(pageLabel)) &&
        // Exclude lines that are outside PDF page view box
        intersectRects(line.rect, contentRects[pageIndex])
      ) {
        currentPageLines.push(line);
      }
    }

    let eps = 0.1;
    contentRects[i] = [
      Math.min(...currentPageLines.map(x => x.rect[0])) + eps,
      Math.min(...currentPageLines.map(x => x.rect[1])) + eps,
      Math.max(...currentPageLines.map(x => x.rect[2])) - eps,
      Math.max(...currentPageLines.map(x => x.rect[3])) - eps,
    ];
  }
  return contentRects;
}

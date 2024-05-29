import {
  getBoundingRect,
  getClosestDistance,
  getSortIndex,
  printOutline,
} from "./util.js";

function charsToText(chars) {
  let text = [];
  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];
    text.push(char.c);
    if ((char.spaceAfter || char.lineBreakAfter) && i !== chars.length - 1) {
      text.push(' ')
    }
  }
  return text.join('');
}

function allUpperCase(chars) {
  return !chars.some(x => x.c !== x.c.toUpperCase());
}

function startsWithLowerCase(chars) {
  let char = chars.find(x => x.c.toLowerCase() !== x.c.toUpperCase());
  if (char) {
    return char.c === char.c.toLowerCase();
  }
  return false;
}

function parseNumberParts(chars) {
  let i = 0;
  while (i < chars.length && ('1' <= chars[i].c && chars[i].c <= '9' || chars[i].c === '.') && !chars[i].spaceAfter) {
    i++;
  }
  let parts = chars.slice(0, i).map(x => x.c).join('').split('.').filter(x => x).map(x => parseInt(x));
  return parts;
}

function getItemsWithDepth(parentItems, rangeGroups, depth) {
  let depthItemGroups = [];
  for (let items of rangeGroups) {
    let depthItems = items.filter(x => x.numberParts.length === depth + 1);
    let uniqueCount = (new Set(depthItems.map(x => x.numberParts.join('.')))).size;
    if (depthItems.length === uniqueCount) {

      let failedValidation = false;
      for (let i = 1; i < depthItems.length; i++) {
        let prevDepthItem = depthItems[i - 1];
        let depthItem = depthItems[i];
        let a = prevDepthItem.numberParts[depth - 1];
        let b = depthItem.numberParts[depth - 1];
        if (a !== b) {

          let aa = parentItems.findLastIndex(x => x.globalOffset < prevDepthItem.globalOffset);
          let bb = parentItems.findLastIndex(x => x.globalOffset < depthItem.globalOffset);
          if (b - a !== bb - aa) {
            failedValidation = true;
          }
        }
      }

      if (!failedValidation) {
        depthItemGroups.push(depthItems);
      }
    }
  }

  return depthItemGroups.sort((a, b) => b.length - a.length)[0];
}

function rangeGroupHasDuplicates(ranges) {
  let unique = new Set();
  for (let range of ranges) {
    if (unique.has(range.text)) {
      return true;
    }
    unique.add(range.text);
  }
  return false;
}

export async function extractOutline(pdfDocument, structuredCharsProvider) {
  let pagesNum = await pdfDocument.pdfManager.ensureDoc('numPages');
  let from = 0;
  let to = pagesNum - 1;

  let pages = [];
  for (let i = from; i <= to; i++) {
    let chars = await structuredCharsProvider(i);
    pages.push(chars);
  }

  let fontRanges = new Map();
  let fontCounts = new Map();
  let rotationCounts = new Map();
  let fontSizes = new Map();

  for (let chars of pages) {
    for (let i = 0; i < chars.length; i++) {
      let char = chars[i];
      let count = fontCounts.get(char.fontName);
      if (!count) {
        count = 0;
      }
      count++;
      fontCounts.set(char.fontName, count);


      count = rotationCounts.get(char.rotation);
      if (!count) {
        count = 0;
      }
      count++;
      rotationCounts.set(char.rotation, count);
    }
  }
  const mainFont = Array.from(fontCounts.entries()).reduce((max, entry) => max[1] > entry[1] ? max : entry)[0];
  const mainRotation = Array.from(rotationCounts.entries()).reduce((max, entry) => max[1] > entry[1] ? max : entry)[0];

  // console.log('main font', mainFont)
  // console.log('main rotation', mainRotation)


  let globalOffset = 0;
  for (let j = 0; j < pages.length; j++) {
    let chars = pages[j];
    let range = null;

    let start = 0;
    let end = 0;

    let lineFontsEqual = true;

    for (let i = 0; i < chars.length; i++) {
      end = i;
      let prevChar = chars[i - 1];
      let char = chars[i];

      let fontID = char.fontName + '-' + (Math.round(char.fontSize * 10) / 10);
      let prevFontID = prevChar && (prevChar.fontName + '-' + (Math.round(prevChar.fontSize * 10) / 10));

      if (end - start > 0 && prevFontID !== fontID) {
        lineFontsEqual = false;
      }


      if (char.lineBreakAfter) {
        let upperCase = allUpperCase(chars.slice(start, end + 1));

        if (range) {
          if (lineFontsEqual && range.fontID === fontID && (!range.upperCase || range.upperCase === upperCase)) {
            range.to = end;
            range.text = chars.slice(range.from, range.to + 1).map(x => x.c).join('');
            range.chars = chars.slice(range.from, range.to + 1);
          }
          else {
            let list = fontRanges.get(range.fontID) || [];
            list.push(range);
            fontRanges.set(range.fontID, list);
            range = null;
          }
        }

        // Begin new range
        if (
          !range &&
          // and all characters in the line have the same font
          lineFontsEqual &&
          // and it doesn't end with a dot
          chars[end].c !== '.' &&
          // and it has a different font than the body text
          chars[start].fontName !== mainFont &&
          // and it has the same rotation as most of the text
          chars[start].rotation === mainRotation
        ) {
          let startsWithLower = startsWithLowerCase(chars.slice(start, end + 1));
          range = {
            pageIndex: j,
            fontID,
            fontSize: (Math.round(char.fontSize * 10) / 10),
            from: start,
            to: end,
            upperCase,
            font: chars[start].font,
            globalOffset,
            // startsWithLower
          };

          range.text = chars.slice(range.from, range.to + 1).map(x => x.c).join('')
          range.chars = chars.slice(range.from, range.to + 1)
          range.numberParts = parseNumberParts(range.chars);
        }

        lineFontsEqual = true;
        start = end + 1;
      }

      // Push the current range if this is the last character in the page
      if (range && i === chars.length - 1) {
        let list = fontRanges.get(range.fontID) || [];
        list.push(range);
        fontRanges.set(range.fontID, list);
        range = null;
      }

      globalOffset++;
    }
  }

  // console.log(fontCounts);
  // console.log(fontRanges);
  // console.log(fontSizes);

  fontRanges = Array.from(fontRanges.values());

  fontRanges.sort((a, b) => b[0].fontSize - a[0].fontSize);

  // Try to determine H1 font
  let titles = [
    'References',
    'Bibliography',
    'Acknowledgments',
    'Bibliographie'
  ];

  // Determine if the font is prevalent in the document
  let prevalentFontsRanges = [];
  for (let i = 0; i < fontRanges.length; i++) {
    let ranges = fontRanges[i];

    let indexes = ranges.map(x => x.pageIndex);
    let min = Math.min(...indexes);
    let max = Math.max(...indexes);
    if (max - min >= pagesNum / 2) {
      prevalentFontsRanges.push(ranges);
    }
  }

  let h1 = [], h2 = [], h3 = [];
  for (let i = 0; i < fontRanges.length; i++) {
    let ranges = fontRanges[i];

    if (!prevalentFontsRanges.includes(ranges) || rangeGroupHasDuplicates(ranges)) {
      continue;
    }

    for (let range of ranges) {
      if (titles.includes(range.text)) {
        h1 = ranges;
        fontRanges.splice(0, i + 1);
        break;
      }
    }
    if (h1) {
      break;
    }
  }

  // If no common title found, use the biggest font
  if (!h1) {
    for (let i = 0; i < fontRanges.length; i++) {
      let ranges = fontRanges[i];

      if (!prevalentFontsRanges.includes(ranges) || rangeGroupHasDuplicates(ranges)) {
        continue;
      }

      h1 = ranges;
      break;
    }
  }

  // console.log('fontRanges', fontRanges)
  // console.log('h1', h1);

  h1.forEach(range => range.depth = 0);
  // Try number based extraction for H2 and H3 levels
  let ranges = getItemsWithDepth(h1, fontRanges, 1);
  if (ranges.length >= 2) {
    h2 = ranges;
    h2.forEach(range => range.depth = 1);
    ranges = getItemsWithDepth(h2, fontRanges, 2);
    if (ranges.length >= 2) {
      h3 = ranges;
      h3.forEach(range => range.depth = 0);
    }
  }
  // Try to use next available font ranges after the H1, but only for H2 level
  else if (fontRanges.length >= 1) {
    let ranges = fontRanges[0];
    if (!rangeGroupHasDuplicates(ranges)) {
      h2 = fontRanges[0];
      h2.forEach(range => range.depth = 1);
    }
  }

  // console.log(h1, h2, h3)

  // Eliminate noise, like header/footer data, etc.
  // Get top level font (by common titles, like References), by only one digit at the beginning, or sequence
  // Eliminate other

  // Include abstract as well at the top

  // TODO: Don't extract anything below references title

  // TODO: Maybe it should extract this list first, to avoid extracting full width bold lines
  //  font that is used for first line bold text shouldn't be used in headings. if there is a big enough
  //  number of lines like this don't use this font for headings
  //  as headings

  // Extract the emphasized lines of text
  let list = [];
  let n = 0;
  for (let j = 0; j < pages.length; j++) {
    let chars = pages[j];
    let start = 0;
    let end = 0;
    for (let i = 0; i < chars.length; i++) {
      end = i;
      let char = chars[i];
      if (char.lineBreakAfter) {
        let prev = chars[start - 1];
        let first = chars[start];
        let last = chars[end];
        if (first.fontName !== mainFont && chars.slice(start, end + 1).some(x => x.fontName === mainFont)) {
          // let firstWidth = first.font.bbox[2] - first.font.bbox[0];
          // let lastWidth = last.font.bbox[2] - last.font.bbox[0];

          let firstName = first.fontName;
          let lastName = last.fontName;
          let nameLength = Math.min(firstName.length, lastName.length);
          let numMatches = 0;
          for (let k = 0; k < nameLength; k++) {
            if (firstName[k] === lastName[k]) {
              numMatches++;
            }
          }

          // TODO: The emphasizes text should end with '.', or ':', or have upper case character after the sequence

          if (//numMatches >= 3 &&
            (!prev || prev.fontName !== first.fontName) &&

            // firstName[nameLength - 1] == lastName[nameLength - 1] &&
            // firstName[nameLength - 2] == lastName[nameLength - 2] &&
            (parseInt(first.c) == first.c || first.c === first.c.toUpperCase())) {

            let k = start;
            for (; k <= end; k++) {
              if (chars[k].fontName !== first.fontName) {
                break;
              }
            }

            let hasDot = ['.', ':'].includes(chars[k - 1].c);
            let nextUpper = chars[k].c === chars[k].c.toUpperCase();

            let dist = getClosestDistance(chars[k - 1].rect, chars[k].rect);
            let largeSpace = dist > chars[k - 1].rect[2] - chars[k - 1].rect[0];

            if ((hasDot /*|| largeSpace*/) && nextUpper) {
              list.push({
                leaf: true,
                pageIndex: j,
                globalOffset: n + start,
                text: chars.slice(start, k).map(x => x.c).join(''),
                chars: chars.slice(start, k),
                from: start,
                to: k
              });
            }
          }

        }

        start = end + 1;
      }
    }
    n += chars.length;
  }

  // console.log('bold ranges', list)

  let items = [
    ...h1,
    ...h2,
    ...h3,
    ...list
  ];

  items.sort((a, b) => a.globalOffset - b.globalOffset);

  // console.log('items', items)

  let root = { items: [] };
  let stack = [root];

  for (let i = 0; i < items.length; i++) {
    let item = items[i];

    let node = {
      items: item.leaf ? undefined : [],
      title: charsToText(item.chars),
      sortIndex: getSortIndex(item.pageIndex, item.from, 0),
      location: {
        position: {
          pageIndex: item.pageIndex,
          rects: [getBoundingRect(item.chars)],
        },
      },
    };

    // Find the correct parent level
    while (stack.length - 1 > item.depth) {
      stack.pop();
    }

    // Add the current node to its parent's items
    stack[stack.length - 1].items.push(node);

    // If it's not a leaf, push it onto the stack
    if (!item.leaf) {
      stack.push(node);
    }
  }

  let outline = root.items;

  // printOutline(outline);
  return outline;
}

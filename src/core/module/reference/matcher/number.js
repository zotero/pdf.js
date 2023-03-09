import {
  getCenterRect,
  getCharsDistance,
  getPositionFromDestination,
  getPositionFromRects,
  getSortIndex,
  intersectRects,
} from '../../util.js';

export async function matchByNumber(pdfDocument, combinedChars, references) {
  let ranges = [];
  let range = null;

  for (let i = 0; i < combinedChars.length; i++) {
    let prevChar = combinedChars[i - 1];
    let char = combinedChars[i];

    if (!range) {
      // Detect three types of number based in text annotation: superscript, brackets, parentheses
      // Citation character capturing starts when there is no active range and a digit is encountered
      // Later [ or ( is prepended (for superscript citations it's not mandatory)
      if ('0' <= char.c && char.c <= '9') {
        // Superscript citation can be a number alone, or inside brackets/parentheses
        if (
          (char.inlineRect[3] - char.inlineRect[1]) > (char.rect[3] - char.rect[1]) * 1.5 &&
          (char.inlineRect[1] + char.inlineRect[3]) / 2 < (char.rect[1] + char.rect[3]) / 2
        ) {
          range = {
            type: 'superscript',
            pageIndex: char.pageIndex,
            chars: [char],
            offsetFrom: i,
            offsetTo: i,
          };
          if (prevChar && ['[', '('].includes(prevChar.c)) {
            range.chars.unshift(prevChar);
          }
        } else if (prevChar && prevChar.c === '[') {
          range = {
            type: 'brackets',
            chars: [prevChar, char],
            pageIndex: char.pageIndex,
            offsetFrom: i,
            offsetTo: i,
          };
        } else if (prevChar && prevChar.c === '(') {
          range = {
            type: 'parentheses',
            chars: [prevChar, char],
            pageIndex: char.pageIndex,
            offsetFrom: i,
            offsetTo: i,
          };
        } else {
          // TODO: If number with internal links points to references page,
          //  it can be assumed that it's a citation
          range = {
            type: 'other',
            chars: [char],
            before: [prevChar],
            pageIndex: char.pageIndex,
            offsetFrom: i,
            offsetTo: i,
          };
        }
      }
    }
      // After starting character collection above, continue the collection until it's one of the characters
    // below and font size doesn't change (superscript)
    else {
      let allowed = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '-', '–'];

      if (
        (!prevChar || prevChar.pageIndex === char.pageIndex) &&
        (
          allowed.includes(char.c) ||
          ['brackets', 'parentheses'].includes(range.type) && [']', ')'].includes(char.c)
        ) &&
        Math.abs(prevChar.fontSize - char.fontSize) < 1
      ) {
        range.chars.push(char);
        range.offsetTo = i;
      }
      else {
        ranges.push(range);
        range = null;
      }
    }
  }

  let pageIndexes = Array.from(new Set(ranges.map(x => x.pageIndex))).sort();


  let internalLinks = new Map();
  for (let pageIndex of pageIndexes) {
    let page = await pdfDocument.getPage(pageIndex);
    let annotations = await page._parsedAnnotations;
    for (let annotation of annotations) {
      annotation = annotation.data;
      let { dest, rect } = annotation;
      if (!dest || !rect) {
        continue;
      }
      let destinationPosition = await getPositionFromDestination(pdfDocument, dest);
      if (destinationPosition) {

        let list = internalLinks.get(pageIndex);
        if (!list) {
          list = [];
          internalLinks.set(pageIndex, list);
        }
        list.push({
          rect,
          destinationPosition,
        });
      }
    }
  }


  // console.log('internal links', internalLinks)

  for (let range of ranges) {
    range.destinationIndexes = [];
    let { pageIndex, chars } = range;
    let pageInternalLinks = internalLinks.get(pageIndex);
    if (pageInternalLinks) {
      for (let internalLink of pageInternalLinks) {
        for (let i = 0; i < chars.length; i++) {
          let char = chars[i];
          let centerRect = getCenterRect(char.rect);
          if (intersectRects(centerRect, internalLink.rect)) {
            let targetPageIndex = internalLink.destinationPosition.pageIndex;
            if (!range.destinationIndexes.includes(targetPageIndex)) {
              range.destinationIndexes.push(targetPageIndex);
            }
          }
        }
      }
    }
  }

  ranges = ranges.filter(x => !(x.type === 'other' && !x.destinationIndexes.length));

  for (let range of ranges) {
    range.text = range.chars.map(x => x.c).join('');
  }

  // Make sure the number isn't alone and is in a paragraph
  let ranges2 = [];
  for (let range of ranges) {
    let charBefore = combinedChars[range.offsetFrom - 2];
    let charAfter = combinedChars[range.offsetTo + 1];
    if (charBefore && charAfter && (
      getCharsDistance(charBefore, combinedChars[range.offsetFrom - 1]) < 15 ||
      getCharsDistance(charAfter, combinedChars[range.offsetTo]) < 15
    )) {
      range.dist1 = getCharsDistance(charBefore, combinedChars[range.offsetFrom]);
      range.dist1c = charBefore;
      range.dist2 = getCharsDistance(charAfter, combinedChars[range.offsetTo]);
      range.dist2c = charAfter;
      ranges2.push(range);
    }
  }
  ranges = ranges2;

  let overlays = [];

  for (let range of ranges) {
    let text = range.chars.map(x => x.c).join('');

    let parts = text.match(/(\d+|\D+)/g);

    let numbers = new Set();

    let lastNum = null;
    let fillInterval = false;
    for (let part of parts) {
      let number = parseInt(part);
      if (number) {
        numbers.add(number);
        if (fillInterval) {
          // Fill the interval but make sure it doesn't grow uncontrollably
          for (let i = lastNum + 1; i < number && numbers.size < 50; i++) {
            numbers.add(i);
          }
        }
        lastNum = number;
      } else {
        if (part.split('').some(x => ['-', '–'].includes(x))) {
          fillInterval = true;
        }
        continue;
      }
      fillInterval = false;
    }

    numbers = Array.from(numbers).sort((a, b) => a - b);

    let refs = [];

    for (let number of numbers) {
      let reference = references.find(x => x.index === number);
      if (reference) {
        refs.push(reference);
        range.internalLinkType = 0;
        if (range.destinationIndexes.length) {
          range.internalLinkType = range.destinationIndexes.includes(reference.position.pageIndex) ? 1 : -1;
        }
      }
    }

    range.numbers = numbers;
    range.references = refs;

    // if (numbers.length !== refs.length || !refs.length) {
    //   continue;
    // }
  }

  ranges = ranges.filter(x => x.internalLinkType !== -1);
  ranges = ranges.filter(x => x.numbers.length);
  ranges = ranges.filter(x => x.references.length);



  // for (let range of ranges) {
  //   console.log(range.type, range.chars.map(x => x.c).join(''), range);
  // }


  let groups = new Map();
  for (let range of ranges) {
    let char = range.chars.find(x => x.c >= '0' && x.c <= '9');

    let id = range.type + '-' + (Math.round(char.fontSize * 10) / 10).toString() + '-' + char.fontName + '-' + range.internalLinkType;

    let group = groups.get(id);
    if (!group) {
      group = {
        ranges: [],
        references: new Set(),
      };
      groups.set(id, group);
    }

    group.ranges.push(range);
    for (let reference of range.references) {
      group.references.add(reference);
    }
  }

  let bestGroup;
  for (let [id, group] of groups) {
    if (!bestGroup || bestGroup.references.size < group.references.size) {
      bestGroup = group;
    }
  }
  if (!bestGroup) {
    return [];
  }

  for (let range of bestGroup.ranges) {

    let { references } = range;

    let word = range.chars;

    let position = getPositionFromRects(word, range.chars[0].pageIndex);
    overlays.push({
      type: 'citation',
      word,
      offset: range.offsetFrom,
      position,
      sortIndex: getSortIndex(range.chars[0].pageIndex, range.offsetFrom, 0),
      references,
    });
  }
  return overlays;
}

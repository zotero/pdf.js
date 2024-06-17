import { getCenterRect, intersectRects } from '../../util.js';
import { getRegularLinkOverlays } from '../../link/link.js';
import { extractByListNumberSpacing } from './list-number-spacing.js';
import { extractByFirstLineIndent } from './first-line-indent.js';
import { extractByParagraphSpacing } from './paragraph-spacing.js';
import { getReferencesTitleOffset } from './common.js';

// TODO: In Mills - 2015 some lines a single therefore they won't be break.
//  Fix that. Use line that aligns other reference start and break everything else that is next to this line
// - Use embedded outline to determine references page

export async function extractReferences(pdfDocument, combinedChars) {
  let sectionOffset = getReferencesTitleOffset(combinedChars);

  let groups = [
    await extractByListNumberSpacing(combinedChars, sectionOffset),
    await extractByFirstLineIndent(combinedChars, sectionOffset),
    await extractByParagraphSpacing(combinedChars, sectionOffset),
  ];

  groups = groups.filter(x => x);

  let bestGroup = null;
  for (let group of groups) {
    if (bestGroup === null || bestGroup.references.length < group.references.length) {
      bestGroup = group;
    }
  }

  if (!bestGroup) {
    return null;
  }

  let { references, offset } = bestGroup;

  await addUrls(pdfDocument, combinedChars, references);

  return { references, offset };
}

async function addUrls(pdfDocument, combinedChars, references) {
  // Uncombine chars
  let charPagesMap = new Map();
  for (let char of combinedChars) {
    if (!charPagesMap.has(char.pageIndex)) {
      charPagesMap.set(char.pageIndex, []);
    }
    charPagesMap.get(char.pageIndex).push(char);
  }
  let allPageIndexes = references.map(x => x.position.pageIndex);
  let minPageIndex = Math.min(...allPageIndexes);
  let maxPageIndex = Math.max(...allPageIndexes);
  for (let i = minPageIndex; i <= maxPageIndex; i++) {
    let linkOverlays = await getRegularLinkOverlays(pdfDocument, charPagesMap.get(i), i);
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

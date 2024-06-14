import { getSortIndex } from '../../util.js';
import { matchByNumber } from './number.js';
import { matchByNameAndYear } from './name-year.js';

/*
  - Number must be in a proper line, there should be enough characters (to exclude equations and formulas)
  - [] must have \p, \n, ' ' at the left, and ' ', \n, \p a at the right
  - If number has internal link and it points to the same then only use this method to determine if numbe is in-text citation
  - Detect special word before number i.e Eq., Equation, Ref. Reference, etc.
*/

export async function getOverlays(pdfDocument, combinedChars, references) {
  let citationOverlays;
  if (references[0].index) {
    citationOverlays = await matchByNumber(pdfDocument, combinedChars, references);
  } else {
    citationOverlays = matchByNameAndYear(combinedChars, references);
  }

  let referenceMap = new Map();

  for (let citationOverlay of citationOverlays) {
    for (let reference of citationOverlay.references) {
      let group = referenceMap.get(reference);
      if (!group) {
        group = [];
        referenceMap.set(reference, group);
      }
      group.push(citationOverlay)
    }
  }

  let referenceOverlays = [];
  for (let [reference, citationOverlays] of referenceMap) {
    let { pageIndex, offset } = reference.chars[0];
    let referenceOverlay = {
      type: 'reference',
      position: reference.position,
      sortIndex: getSortIndex(pageIndex, offset, 0),
      references: [reference],
      citations: [],
    };

    for (let citationOverlay of citationOverlays) {
      let { word, offset, position } = citationOverlay;
      referenceOverlay.citations.push({ word, offset, position });
    }

    referenceOverlays.push(referenceOverlay);
  }

  return { citationOverlays, referenceOverlays };
}

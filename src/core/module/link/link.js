import { getParsedOverlays } from './parsed-overlays.js';
import { getAnnotationOverlays } from './annotation-overlays.js';
import { getMatchedOverlays } from './matched-overlays.js';
import { overlaysIntersect } from '../util.js';

export async function getRegularLinkOverlays(pdfDocument, chars, pageIndex) {
  let annotationOverlays = await getAnnotationOverlays(pdfDocument, chars, pageIndex);
  let parsedOverlays = getParsedOverlays(chars);
  let overlays = [...annotationOverlays];
  // Add parsed overlays that doesn't intersect with annotation overlays
  for (let parsedOverlay of parsedOverlays) {
    if (!annotationOverlays.some(x => overlaysIntersect(x, parsedOverlay))) {
      overlays.push(parsedOverlay);
    }
  }
  return overlays;
}

export async function getLinkOverlays(pdfDocument, structuredCharsProvider, contentRect){
  let maxPages = Math.min(50, pdfDocument.catalog.numPages);
  let pages = new Map();
  for (let i = 0; i < maxPages; i++) {
    let chars = await structuredCharsProvider(i);
    let annotationOverlays = await getAnnotationOverlays(pdfDocument, chars, i);
    let parsedOverlays = getParsedOverlays(chars);
    let matchedOverlays = await getMatchedOverlays(pdfDocument, structuredCharsProvider, i, annotationOverlays, contentRect);

    let overlays = [...annotationOverlays];

    for (let matchedOverlay of matchedOverlays) {
      if (!overlays.some(x => overlaysIntersect(x, matchedOverlay))) {
        overlays.push(matchedOverlay);
      }
    }

    for (let parsedOverlay of parsedOverlays) {
      if (!overlays.some(x => overlaysIntersect(x, parsedOverlay))) {
        overlays.push(parsedOverlay);
      }
    }

    if (overlays.length) {
      pages.set(i, overlays);
    }
  }
  return pages;
}

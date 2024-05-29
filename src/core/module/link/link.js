import { getParsedOverlays } from './parsed-overlays.js';
import { getAnnotationOverlays } from './annotation-overlays.js';
import { getMatchedOverlays } from './matched-overlays.js';
import { overlaysIntersect } from '../util.js';

export async function getRegularLinkOverlays(pdfDocument, structuredCharsProvider, pageIndex) {
  let annotationOverlays = await getAnnotationOverlays(pdfDocument, structuredCharsProvider, pageIndex);
  let parsedOverlays = await getParsedOverlays(pdfDocument, structuredCharsProvider, pageIndex);
  let overlays = [...annotationOverlays];
  for (let parsedOverlay of parsedOverlays) {
    if (!annotationOverlays.some(x => overlaysIntersect(x, parsedOverlay))) {
      overlays.push(parsedOverlay);
    }
  }
  return overlays;
}

export async function getLinkOverlays(pdfDocument, structuredCharsProvider, contentRect, pageIndex){
  let annotationOverlays = await getAnnotationOverlays(pdfDocument, structuredCharsProvider, pageIndex);
  let parsedOverlays = await getParsedOverlays(pdfDocument, structuredCharsProvider, pageIndex);
  let matchedOverlays = await getMatchedOverlays(pdfDocument, structuredCharsProvider, pageIndex, annotationOverlays, contentRect);
  return [...annotationOverlays, ...parsedOverlays, ...matchedOverlays];
}

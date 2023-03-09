import {
  getPositionFromDestination,
  overlayDestinationsEqual
} from './util.js';
import { getRectCenter, getSortIndex } from '../utilities.js';

async function _getLinkAnnotationOverlays(pdfDocument, structuredCharsProvider, pageIndex){
  let overlays = [];
  let chars = await structuredCharsProvider(pageIndex);
  let page = await pdfDocument.getPage(pageIndex);
  let annotations = await page._parsedAnnotations;
  for (let annotation of annotations) {
    annotation = annotation.data;
    let { url, dest, rect } = annotation;
    if (!url && !dest || !rect) {
      continue;
    }

    let offsetFrom = null;
    let offsetTo = null;
    // Get continuous sequence of chars covered by link annotation, otherwise
    // don't use set offset range
    for (let i = 0; i < chars.length; i++) {
      let char = chars[i];
      let { x, y } = getRectCenter(char.rect);
      if (rect[0] <= x && x <= rect[2] && rect[1] <= y && y <= rect[3]) {
        if (offsetFrom !== null) {
          if (i - offsetFrom !== 1) {
            offsetFrom = null;
            offsetTo = null;
            break;
          }
        } else {
          offsetFrom = i;
        }
        offsetTo = i;
      }
    }
    let overlay = {
      source: 'annotation',
      sortIndex: getSortIndex(pageIndex, offsetFrom || 0, 0),
      position: {
        pageIndex,
        rects: [annotation.rect],
      },
    };
    if (offsetFrom !== null) {
      overlay.offsetFrom = offsetFrom;
      overlay.offsetTo = offsetTo;
      if (offsetFrom === 0) {
        overlay.first = true;
      }
      if (overlay.offsetTo === chars.length - 1) {
        overlay.last = true;
      }
    }
    if (annotation.url) {
      overlay.type = 'external-link';
      overlay.url = url;
      overlays.push(overlay);
    } else if (annotation.dest) {
      overlay.type = 'internal-link'
      let destinationPosition = await getPositionFromDestination(pdfDocument, annotation.dest);
      if (destinationPosition) {
        overlay.destinationPosition = destinationPosition;
        overlays.push(overlay);
      }
    }
  }
  let combinedOverlays = [];
  for (let overlay of overlays) {
    let prevOverlay = combinedOverlays.at(-1);
    if (
      // If previously add overlay already exists
      prevOverlay &&
      // and it finishes exactly where the current overlay starts
      prevOverlay.offsetTo + 1 === overlay.offsetFrom &&
      // and positions are equal if they both are internal links
      overlayDestinationsEqual(prevOverlay, overlay)
    ) {
      // Extend previous overlay offset
      prevOverlay.offsetTo = overlay.offsetTo;
      // Add rect from the current overlay to the previous overlay
      if (prevOverlay.position) {
        prevOverlay.position.rects.push(overlay.position.rects[0]);
      }
    } else {
      // If there are no previous overlay or its destination
      // doesn't match with the current overlay's
      combinedOverlays.push(overlay);
    }
  }

  return combinedOverlays;
}

export async function getAnnotationOverlays(pdfDocument, structuredCharsProvider, pageIndex) {
  let linkOverlays = await _getLinkAnnotationOverlays(pdfDocument, structuredCharsProvider, pageIndex);
  for (let linkOverlay of linkOverlays) {
    delete linkOverlay.offsetFrom;
    delete linkOverlay.offsetTo;
    delete linkOverlay.first;
    delete linkOverlay.last;
  }
  return linkOverlays;
}

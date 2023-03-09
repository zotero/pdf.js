import { extractReferences } from './extractor/extractor.js';
import { getOverlays } from './matcher/matcher.js';

export async function getCitationAndReferenceOverlays(pdfDocument, structuredCharsProvider) {
  let { numPages } = pdfDocument.catalog;

  if (numPages > 100) {
    return [];
  }

  let combinedChars = [];

  for (let i = 0; i < numPages; i++) {
    let chars = await structuredCharsProvider(i);
    chars = chars.filter(x => !x.isolated).map(x => ({ ...x }));
    combinedChars.push(...chars);
  }

  let res = await extractReferences(pdfDocument, combinedChars);
  if (!res) {
    return [];
  }

  let { references, offset } = res;

  combinedChars = combinedChars.slice(0, offset);

  let { citationOverlays, referenceOverlays} = await getOverlays(pdfDocument, combinedChars, references);

  return [...citationOverlays, ...referenceOverlays];
}

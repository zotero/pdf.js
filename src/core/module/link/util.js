import { basicDeepEqual } from '../util.js';

export function overlayDestinationsEqual(a, b) {
  return (
    (a.type === "internal-link" &&
      b.type === "internal-link" &&
      basicDeepEqual(a.position, b.position)) ||
    // or urls are equal if they both are external links
    (a.type === "external-link" &&
      b.type === "external-link" &&
      a.url === b.url)
  );
}

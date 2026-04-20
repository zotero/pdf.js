/* Copyright 2026 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from "fs";
import { parseArgs } from "node:util";
import path from "path";

const __dirname = import.meta.dirname;
const PROJECT_ROOT = path.join(__dirname, "../..");

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    code: { type: "string" },
    "coverage-dir": { type: "string", default: "build/coverage" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || !values.code) {
  console.log(
    "Usage: coverage_search.mjs --code=<file>::<line|function> [--coverage-dir=<path>]\n\n" +
      "  --code          Source file and line number or function name to search for.\n" +
      "                  Examples:\n" +
      "                    --code=canvas.js::205\n" +
      "                    --code=canvas.js::drawImageAtIntegerCoords\n" +
      "  --coverage-dir  Coverage directory containing per-test-index.json [build/coverage]\n\n" +
      "Prints to stdout the IDs of tests whose coverage includes the given line or\n" +
      "function (one ID per line).\n" +
      "Run browsertest with --coverage-per-test first to generate the index."
  );
  process.exit(values.help ? 0 : 1);
}

const sep = values.code.indexOf("::");
if (sep === -1) {
  console.error(
    "Error: --code must be in format 'file.js::line_or_function', e.g. canvas.js::205"
  );
  process.exit(1);
}

const fileName = values.code.slice(0, sep);
const location = values.code.slice(sep + 2);
const isLine = /^\d+$/.test(location);
const lineNum = isLine ? parseInt(location, 10) : null;
const funcName = isLine ? null : location;

const coverageDir = path.isAbsolute(values["coverage-dir"])
  ? values["coverage-dir"]
  : path.join(PROJECT_ROOT, values["coverage-dir"]);

const indexPath = path.join(coverageDir, "per-test-index.json");
if (!fs.existsSync(indexPath)) {
  console.error(`Error: index file not found: ${indexPath}`);
  console.error("Run browsertest with --coverage-per-test first.");
  process.exit(1);
}

const { ids, files } = JSON.parse(fs.readFileSync(indexPath, "utf8"));

// Find the file entry whose path matches fileName.
let fileEntry = null;
for (const [filePath, entry] of Object.entries(files)) {
  if (
    filePath === fileName ||
    filePath.endsWith(`/${fileName}`) ||
    filePath.endsWith(`\\${fileName}`)
  ) {
    fileEntry = entry;
    break;
  }
}

if (!fileEntry) {
  process.exit(0);
}

let testIndices = null;

if (lineNum !== null) {
  // Direct line lookup.
  testIndices = fileEntry.l?.[lineNum];

  // If no hit, check whether lineNum is a function declaration start and
  // redirect to that function's coverage.
  if (!testIndices && fileEntry.fstarts?.[lineNum]) {
    testIndices = fileEntry.f?.[fileEntry.fstarts[lineNum]];
  }
} else {
  testIndices = fileEntry.f?.[funcName];
}

if (testIndices) {
  for (const idx of testIndices) {
    console.log(ids[idx]);
  }
}

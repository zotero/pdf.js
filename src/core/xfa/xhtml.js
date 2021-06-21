/* Copyright 2021 Mozilla Foundation
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

import {
  $acceptWhitespace,
  $childrenToHTML,
  $content,
  $extra,
  $getChildren,
  $globalData,
  $nodeName,
  $onText,
  $pushGlyphs,
  $text,
  $toHTML,
  XmlObject,
} from "./xfa_object.js";
import { $buildXFAObject, NamespaceIds } from "./namespaces.js";
import { fixTextIndent, getFonts, measureToString } from "./html_utils.js";
import { getMeasurement, HTMLResult } from "./utils.js";

const XHTML_NS_ID = NamespaceIds.xhtml.id;

const VALID_STYLES = new Set([
  "color",
  "font",
  "font-family",
  "font-size",
  "font-stretch",
  "font-style",
  "font-weight",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "letter-spacing",
  "line-height",
  "orphans",
  "page-break-after",
  "page-break-before",
  "page-break-inside",
  "tab-interval",
  "tab-stop",
  "text-align",
  "text-decoration",
  "text-indent",
  "vertical-align",
  "widows",
  "kerning-mode",
  "xfa-font-horizontal-scale",
  "xfa-font-vertical-scale",
  "xfa-spacerun",
  "xfa-tab-stops",
]);

const StyleMapping = new Map([
  ["page-break-after", "breakAfter"],
  ["page-break-before", "breakBefore"],
  ["page-break-inside", "breakInside"],
  ["kerning-mode", value => (value === "none" ? "none" : "normal")],
  [
    "xfa-font-horizontal-scale",
    value =>
      `scaleX(${Math.max(0, Math.min(parseInt(value) / 100)).toFixed(2)})`,
  ],
  [
    "xfa-font-vertical-scale",
    value =>
      `scaleY(${Math.max(0, Math.min(parseInt(value) / 100)).toFixed(2)})`,
  ],
  ["xfa-spacerun", ""],
  ["xfa-tab-stops", ""],
  ["font-size", value => measureToString(getMeasurement(value))],
  ["letter-spacing", value => measureToString(getMeasurement(value))],
  ["line-height", value => measureToString(getMeasurement(value))],
  ["margin", value => measureToString(getMeasurement(value))],
  ["margin-bottom", value => measureToString(getMeasurement(value))],
  ["margin-left", value => measureToString(getMeasurement(value))],
  ["margin-right", value => measureToString(getMeasurement(value))],
  ["margin-top", value => measureToString(getMeasurement(value))],
  ["text-indent", value => measureToString(getMeasurement(value))],
  ["font-family", (value, fontFinder) => getFonts(value, fontFinder)],
]);

const spacesRegExp = /\s+/g;
const crlfRegExp = /[\r\n]+/g;

function mapStyle(styleStr, fontFinder) {
  const style = Object.create(null);
  if (!styleStr) {
    return style;
  }
  for (const [key, value] of styleStr.split(";").map(s => s.split(":", 2))) {
    const mapping = StyleMapping.get(key);
    if (mapping === "") {
      continue;
    }
    let newValue = value;
    if (mapping) {
      if (typeof mapping === "string") {
        newValue = mapping;
      } else {
        newValue = mapping(value, fontFinder);
      }
    }
    if (key.endsWith("scale")) {
      if (style.transform) {
        style.transform = `${style[key]} ${newValue}`;
      } else {
        style.transform = newValue;
      }
    } else {
      style[key.replaceAll(/-([a-zA-Z])/g, (_, x) => x.toUpperCase())] =
        newValue;
    }
  }

  fixTextIndent(style);
  return style;
}

function checkStyle(style) {
  if (!style) {
    return "";
  }

  // Remove any non-allowed keys.
  return style
    .trim()
    .split(/\s*;\s*/)
    .filter(s => !!s)
    .map(s => s.split(/\s*:\s*/, 2))
    .filter(([key]) => VALID_STYLES.has(key))
    .map(kv => kv.join(":"))
    .join(";");
}

const NoWhites = new Set(["body", "html"]);

class XhtmlObject extends XmlObject {
  constructor(attributes, name) {
    super(XHTML_NS_ID, name);
    this.style = checkStyle(attributes.style);
  }

  [$acceptWhitespace]() {
    return !NoWhites.has(this[$nodeName]);
  }

  [$onText](str) {
    str = str.replace(crlfRegExp, "");
    if (!this.style.includes("xfa-spacerun:yes")) {
      str = str.replace(spacesRegExp, " ");
    }
    if (str) {
      this[$content] += str;
    }
  }

  [$pushGlyphs](measure) {
    const xfaFont = Object.create(null);
    for (const [key, value] of this.style
      .split(";")
      .map(s => s.split(":", 2))) {
      if (!key.startsWith("font-")) {
        continue;
      }
      if (key === "font-family") {
        xfaFont.typeface = value;
      } else if (key === "font-size") {
        xfaFont.size = getMeasurement(value);
      } else if (key === "font-weight") {
        xfaFont.weight = value;
      } else if (key === "font-style") {
        xfaFont.posture = value;
      }
    }
    measure.pushFont(xfaFont);
    if (this[$content]) {
      measure.addString(this[$content]);
    } else {
      for (const child of this[$getChildren]()) {
        if (child[$nodeName] === "#text") {
          measure.addString(child[$content]);
          continue;
        }
        child[$pushGlyphs](measure);
      }
    }
    measure.popFont();
  }

  [$toHTML](availableSpace) {
    const children = [];
    this[$extra] = {
      children,
    };

    this[$childrenToHTML]({});

    if (children.length === 0 && !this[$content]) {
      return HTMLResult.EMPTY;
    }

    return HTMLResult.success({
      name: this[$nodeName],
      attributes: {
        href: this.href,
        style: mapStyle(this.style, this[$globalData].fontFinder),
      },
      children,
      value: this[$content] || "",
    });
  }
}

class A extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "a");
    this.href = attributes.href || "";
  }
}

class B extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "b");
  }

  [$pushGlyphs](measure) {
    measure.pushFont({ weight: "bold" });
    super[$pushGlyphs](measure);
    measure.popFont();
  }
}

class Body extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "body");
  }

  [$toHTML](availableSpace) {
    const res = super[$toHTML](availableSpace);
    const { html } = res;
    if (!html) {
      return HTMLResult.EMPTY;
    }
    html.name = "div";
    html.attributes.class = ["xfaRich"];
    return res;
  }
}

class Br extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "br");
  }

  [$text]() {
    return "\n";
  }

  [$pushGlyphs](measure) {
    measure.addString("\n");
  }

  [$toHTML](availableSpace) {
    return HTMLResult.success({
      name: "br",
    });
  }
}

class Html extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "html");
  }

  [$toHTML](availableSpace) {
    const children = [];
    this[$extra] = {
      children,
    };

    this[$childrenToHTML]({});
    if (children.length === 0) {
      return HTMLResult.success({
        name: "div",
        attributes: {
          class: ["xfaRich"],
          style: {},
        },
        value: this[$content] || "",
      });
    }

    if (children.length === 1) {
      const child = children[0];
      if (child.attributes && child.attributes.class.includes("xfaRich")) {
        return HTMLResult.success(child);
      }
    }

    return HTMLResult.success({
      name: "div",
      attributes: {
        class: ["xfaRich"],
        style: {},
      },
      children,
    });
  }
}

class I extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "i");
  }

  [$pushGlyphs](measure) {
    measure.pushFont({ posture: "italic" });
    super[$pushGlyphs](measure);
    measure.popFont();
  }
}

class Li extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "li");
  }
}

class Ol extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "ol");
  }
}

class P extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "p");
  }

  [$pushGlyphs](measure) {
    super[$pushGlyphs](measure);
    measure.addString("\n");
  }

  [$text]() {
    return super[$text]() + "\n";
  }
}

class Span extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "span");
  }
}

class Sub extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "sub");
  }
}

class Sup extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "sup");
  }
}

class Ul extends XhtmlObject {
  constructor(attributes) {
    super(attributes, "ul");
  }
}

class XhtmlNamespace {
  static [$buildXFAObject](name, attributes) {
    if (XhtmlNamespace.hasOwnProperty(name)) {
      return XhtmlNamespace[name](attributes);
    }
    return undefined;
  }

  static a(attributes) {
    return new A(attributes);
  }

  static b(attributes) {
    return new B(attributes);
  }

  static body(attributes) {
    return new Body(attributes);
  }

  static br(attributes) {
    return new Br(attributes);
  }

  static html(attributes) {
    return new Html(attributes);
  }

  static i(attributes) {
    return new I(attributes);
  }

  static li(attributes) {
    return new Li(attributes);
  }

  static ol(attributes) {
    return new Ol(attributes);
  }

  static p(attributes) {
    return new P(attributes);
  }

  static span(attributes) {
    return new Span(attributes);
  }

  static sub(attributes) {
    return new Sub(attributes);
  }

  static sup(attributes) {
    return new Sup(attributes);
  }

  static ul(attributes) {
    return new Ul(attributes);
  }
}

export { XhtmlNamespace };

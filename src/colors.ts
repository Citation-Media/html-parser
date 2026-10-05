/**
 * CSS colours as sRGB, for comparing the colours a stylesheet writes in different notations: hex,
 * rgb(), hsl(), oklch(), oklab(), and the named colours. Functions that depend on the element, such
 * as currentcolor, color-mix(), or relative colours, are not colours here; they return `null`.
 */

export interface Rgb {
  /** Red, green, and blue from 0 to 255; alpha from 0 to 1. */
  r: number;
  g: number;
  b: number;
  alpha: number;
}

// The 148 named colours of CSS Color 4, as hex without the hash.
const namedSource = `
  aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc
  bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a
  burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50
  cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b
  darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9
  darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc
  darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f
  darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff
  dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0
  forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700
  goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0
  hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa
  lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080
  lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90
  lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa
  lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0
  lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa
  mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371
  mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585
  midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead
  navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500
  orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093
  papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6
  purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1
  saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee
  sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090
  snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8
  tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5
  yellow:ffff00 yellowgreen:9acd32
`;
const named = new Map(
  namedSource
    .trim()
    .split(/\s+/u)
    .map((pair) => {
      const [name = "", hex = ""] = pair.split(":");
      return [name, hex];
    })
);

const clamp = (value: number) => Math.min(255, Math.max(0, value));

const fromHex = (hex: string): Rgb | null => {
  const digits =
    hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
  if (!/^[\da-f]{6}(?:[\da-f]{2})?$/iu.test(digits)) {
    return null;
  }
  const channel = (index: number) =>
    Number.parseInt(digits.slice(index, index + 2), 16);
  return {
    alpha: digits.length === 8 ? channel(6) / 255 : 1,
    b: channel(4),
    g: channel(2),
    r: channel(0),
  };
};

/** The arguments of a colour function, in either the comma or the space syntax, alpha last. */
const argumentsOf = (body: string) => {
  const [channels = "", alpha] = body.split("/");
  const parts = channels
    .split(/[\s,]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (alpha !== undefined) {
    parts.push(alpha.trim());
  }
  return parts;
};

/** The number at the start of a value, without its unit, such as 50 for `50%` or `50deg`. */
const leadingNumber = (value: string) =>
  Number(
    /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iu.exec(value)?.[0] ?? Number.NaN
  );

/** A number, a percentage of `full`, or `none` as zero. */
const numberOf = (value: string, full: number) => {
  if (value === "none") {
    return 0;
  }
  const number = leadingNumber(value);
  return value.endsWith("%") ? (number / 100) * full : number;
};

/** Saturation or lightness from 0 to 1: a percentage, or a number from 0 to 100. */
const fractionOf = (value: string) =>
  value.endsWith("%") ? numberOf(value, 1) : numberOf(value, 1) / 100;

const alphaOf = (value: string | undefined) =>
  value === undefined ? 1 : Math.min(1, Math.max(0, numberOf(value, 1)));

/** Degrees from a hue in deg, rad, grad, or turn. */
const degreesOf = (value: string) => {
  const number = leadingNumber(value);
  if (value.endsWith("turn")) {
    return number * 360;
  }
  if (value.endsWith("grad")) {
    return number * 0.9;
  }
  if (value.endsWith("rad")) {
    return (number * 180) / Math.PI;
  }
  return value === "none" ? 0 : number;
};

const fromHsl = (hue: number, saturation: number, lightness: number) => {
  const amount = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return 255 * (lightness - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return { b: channel(4), g: channel(8), r: channel(0) };
};

/** Linear sRGB to the gamma-encoded 0 to 255 range. */
const encode = (linear: number) =>
  clamp(
    255 *
      (linear <= 0.0031308
        ? 12.92 * linear
        : 1.055 * linear ** (1 / 2.4) - 0.055)
  );

const fromOklab = (lightness: number, a: number, b: number) => {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
  };
};

const functionColor = (name: string, body: string): Rgb | null => {
  const [first = "", second = "", third = "", alpha] = argumentsOf(body);
  if (name === "rgb" || name === "rgba") {
    return {
      alpha: alphaOf(alpha),
      b: clamp(numberOf(third, 255)),
      g: clamp(numberOf(second, 255)),
      r: clamp(numberOf(first, 255)),
    };
  }
  if (name === "hsl" || name === "hsla") {
    return {
      ...fromHsl(degreesOf(first), fractionOf(second), fractionOf(third)),
      alpha: alphaOf(alpha),
    };
  }
  if (name === "oklch") {
    const hue = (degreesOf(third) * Math.PI) / 180;
    const chroma = numberOf(second, 0.4);
    return {
      ...fromOklab(
        numberOf(first, 1),
        chroma * Math.cos(hue),
        chroma * Math.sin(hue)
      ),
      alpha: alphaOf(alpha),
    };
  }
  if (name === "oklab") {
    return {
      ...fromOklab(
        numberOf(first, 1),
        numberOf(second, 0.4),
        numberOf(third, 0.4)
      ),
      alpha: alphaOf(alpha),
    };
  }
  return null;
};

const isValid = (color: Rgb | null) =>
  color !== null &&
  [color.r, color.g, color.b, color.alpha].every((channel) =>
    Number.isFinite(channel)
  );

const readColor = (value: string): Rgb | null => {
  const text = value.trim().toLowerCase();
  if (text.startsWith("#")) {
    return fromHex(text.slice(1));
  }
  if (text === "transparent") {
    return { alpha: 0, b: 0, g: 0, r: 0 };
  }
  const call = /^(?<name>[a-z]+)\((?<body>.*)\)$/u.exec(text)?.groups;
  if (call) {
    const { name = "", body = "" } = call;
    // A variable left in a channel, or a relative colour, has no fixed value.
    return body.includes("var(") || body.startsWith("from ")
      ? null
      : functionColor(name, body);
  }
  const hex = named.get(text);
  return hex ? fromHex(hex) : null;
};

/** The colour `value` names, or `null` where it is no colour or depends on the element. */
export const parseColor = (value: string): Rgb | null => {
  const color = readColor(value);
  // A channel that is no number, such as a preprocessor's leftover `rgba(#000, .5)`, is no colour.
  return isValid(color) ? color : null;
};

/** The colour as six-digit hex, without alpha. */
export const toHex = ({ r, g, b }: Rgb) =>
  `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;

// The colour tokens of a declaration's value: hex, colour functions, and words that may be names.
const colorToken =
  /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^()]*\)|\b[a-z]+\b/giu;

/** Every colour a declaration's value writes, such as both in `1px solid #ccc` or a gradient. */
export const colorsIn = (value: string): Rgb[] =>
  [...value.matchAll(colorToken)].flatMap(([token]) => {
    const color =
      /^[a-z]+$/iu.test(token) && !named.has(token.toLowerCase())
        ? null
        : parseColor(token);
    return color ? [color] : [];
  });

const toLinear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const pivot = (value: number) =>
  value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;

const toLab = ({ r, g, b }: Rgb) => {
  const [red, green, blue] = [toLinear(r), toLinear(g), toLinear(b)];
  const x = pivot((red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047);
  const y = pivot(red * 0.2126 + green * 0.7152 + blue * 0.0722);
  const z = pivot((red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const;
};

/**
 * How far apart two colours look, as the CIE76 distance in Lab: below 1 the eye cannot tell them
 * apart, so colours written in different notations or rounded differently count as the same.
 */
export const colorDistance = (first: Rgb, second: Rgb) => {
  const [l1, a1, b1] = toLab(first);
  const [l2, a2, b2] = toLab(second);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

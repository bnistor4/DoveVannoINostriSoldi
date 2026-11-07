import { parseHTML } from "linkedom";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** HTML consentito nelle tile di testo board (no script, no eventi). */

const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "SPAN",
  "DIV",
]);

function safeDeclaration(prop: string, value: string): string | null {
  const property = prop.trim().toLowerCase();
  const val = value.trim();
  if (!val || /expression|url\s*\(|javascript:/iu.test(val)) return null;

  let valid = false;
  switch (property) {
    case "color":
      valid =
        /^#[0-9a-f]{3,8}$/iu.test(val)
        || /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*(0|1|0?\.\d+))?\s*\)$/iu.test(val)
        || /^[a-z]{3,20}$/iu.test(val);
      break;
    case "font-size":
      valid =
        /^\d{1,3}(\.\d{1,3})?(rem|em|px|%)$/iu.test(val)
        || /^(xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/iu.test(val);
      break;
    case "font-weight":
      valid = /^(normal|bold|bolder|lighter|[1-9]00)$/iu.test(val);
      break;
    case "font-style":
      valid = /^(normal|italic|oblique)$/iu.test(val);
      break;
    case "text-decoration":
      valid = /^(none|underline|overline|line-through)(\s+(none|underline|overline|line-through))*$/iu.test(val);
      break;
    case "text-align":
      valid = /^(left|right|center|justify|start|end)$/iu.test(val);
      break;
    case "font-family":
      valid = val.split(",").every((family) =>
        /^(?:[a-z0-9][a-z0-9 _-]{0,40}|'[a-z0-9 _-]{1,40}'|"[a-z0-9 _-]{1,40}"|var\(--[a-z0-9-]{1,40}\))$/iu.test(
          family.trim(),
        ),
      );
      break;
    default:
      return null;
  }

  return valid ? `${property}: ${val}` : null;
}

function sanitizeStyle(value: string): string | null {
  const parts: string[] = [];
  for (const declaration of value.split(";")) {
    const [rawProp, ...rest] = declaration.split(":");
    if (!rawProp || rest.length === 0) continue;
    const safe = safeDeclaration(rawProp, rest.join(":"));
    if (safe) parts.push(safe);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function parseSanitizeRoot(html: string): Element | null {
  const wrapped = `<div>${html}</div>`;
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(wrapped, "text/html");
    return doc.body.firstElementChild;
  }
  const { document } = parseHTML(wrapped);
  return document.firstElementChild;
}

/** Sanitizza HTML lato client (DOMParser). */
export function sanitizeBoardHtml(html: string): string {
  const root = parseSanitizeRoot(html);
  if (!root) return "";
  const walk = (node: Node): string => {
    if (node.nodeType === TEXT_NODE) {
      return escapeHtml(node.textContent ?? "");
    }
    if (node.nodeType !== ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return "";
    // execCommand produce ancora <font>; lo convertiamo in <span style="…">.
    if (tag === "FONT") {
      const parts: string[] = [];
      const color = el.getAttribute("color");
      const face = el.getAttribute("face");
      const size = el.getAttribute("size");
      if (color) {
        const safe = safeDeclaration("color", color);
        if (safe) parts.push(safe);
      }
      if (face) {
        const safe = safeDeclaration("font-family", face);
        if (safe) parts.push(safe);
      }
      if (size) {
        const map: Record<string, string> = {
          "1": "0.75rem",
          "2": "0.85rem",
          "3": "1rem",
          "4": "1.15rem",
          "5": "1.35rem",
          "6": "1.6rem",
          "7": "1.85rem",
        };
        const safe = safeDeclaration("font-size", map[size] ?? "1rem");
        if (safe) parts.push(safe);
      }
      const existing = el.getAttribute("style");
      if (existing) {
        const safe = sanitizeStyle(existing);
        if (safe) parts.push(safe);
      }
      const style = parts.length > 0 ? ` style="${escapeHtml(parts.join("; "))}"` : "";
      const inner = Array.from(el.childNodes).map(walk).join("");
      return style ? `<span${style}>${inner}</span>` : inner;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      return Array.from(el.childNodes).map(walk).join("");
    }
    if (tag === "BR") return "<br>";
    const style = el.getAttribute("style");
    const safeStyle = style ? sanitizeStyle(style) : null;
    const open = safeStyle
      ? `<${tag.toLowerCase()} style="${escapeHtml(safeStyle)}">`
      : `<${tag.toLowerCase()}>`;
    const inner = Array.from(el.childNodes).map(walk).join("");
    if (tag === "SPAN" && !safeStyle) return inner;
    return `${open}${inner}</${tag.toLowerCase()}>`;
  };
  return Array.from(root.childNodes).map(walk).join("").slice(0, 8_000);
}

/** Testo piano per title/export. */
export function plainTextFromHtml(html: string): string {
  const root = parseSanitizeRoot(html);
  const text = (root?.textContent ?? html)
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return text.slice(0, 120) || "Testo";
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function paragraphHtml(text: string, style?: string): string {
  const safe = escapeHtml(text);
  const safeStyle = style ? sanitizeStyle(style) : null;
  return safeStyle
    ? `<p style="${escapeHtml(safeStyle)}">${safe}</p>`
    : `<p>${safe}</p>`;
}

/** Converte body legacy (testo piano) o HTML già presente in HTML sanitizzato. */
export function ensureBoardHtml(raw: string | undefined | null, fallback = ""): string {
  const value = (raw ?? "").trim();
  if (!value) return fallback ? paragraphHtml(fallback) : "";
  if (/<[a-z][\s\S]*>/iu.test(value)) {
    return sanitizeBoardHtml(value);
  }
  return paragraphHtml(value);
}

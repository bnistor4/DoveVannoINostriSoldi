import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  ensureBoardHtml,
  plainTextFromHtml,
  sanitizeBoardHtml,
} from "../src/lib/boards/board-html.ts";

function assertOnlyStyleAttributes(html) {
  const { document } = parseHTML(`<div>${html}</div>`);
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      assert.equal(attribute.name, "style");
    }
  }
}

test("sanitizeBoardHtml drops script content in DOM walk", () => {
  const dirty = '<p>ok<script>alert(1)</script><script>more</script></p>';
  const clean = sanitizeBoardHtml(dirty);
  assert.match(clean, /ok/);
  assert.doesNotMatch(clean, /script|alert/i);
});

test("sanitizeBoardHtml strips scripts and keeps safe inline styles", () => {
  const dirty =
    '<p style="color: #b42332; font-size: 1.2rem" onclick="alert(1)">Ciao <script>x()</script><em>mondo</em></p>';
  const clean = sanitizeBoardHtml(dirty);
  assert.match(clean, /<p style="color: #b42332; font-size: 1.2rem">/);
  assert.match(clean, /<em>mondo<\/em>/);
  assert.doesNotMatch(clean, /script|onclick/i);
});

test("ensureBoardHtml wraps plain text and preserves HTML", () => {
  assert.equal(ensureBoardHtml("Solo testo"), "<p>Solo testo</p>");
  assert.equal(
    ensureBoardHtml('<p style="font-size: 1rem">Già HTML</p>'),
    '<p style="font-size: 1rem">Già HTML</p>',
  );
  assert.equal(plainTextFromHtml("<p>Titolo <strong>forte</strong></p>"), "Titolo forte");
});

test("sanitizeBoardHtml keeps encoded text from becoming markup", () => {
  const clean = sanitizeBoardHtml('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(clean, "<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  assert.doesNotMatch(clean, /<img/i);
});

test("sanitizeBoardHtml escapes hostile style values in attributes", () => {
  const clean = sanitizeBoardHtml(
    '<span style="color:red&quot; onmouseover=&quot;x">a</span>',
  );
  assert.doesNotMatch(clean, /\sonmouseover=/i);
  assertOnlyStyleAttributes(clean);
});

test("sanitizeBoardHtml drops injected attributes from legacy font tags", () => {
  for (const dirty of [
    `<font color='red" onmouseover="x'>a</font>`,
    `<font face='x" onmouseover="y'>a</font>`,
  ]) {
    assertOnlyStyleAttributes(sanitizeBoardHtml(dirty));
  }
});

test("sanitizeBoardHtml rejects markup injected through font-family styles", () => {
  const clean = sanitizeBoardHtml(
    '<p style="font-family: x&quot;&gt;&lt;img src=x onerror=1&gt;">t</p>',
  );
  assert.doesNotMatch(clean, /<img/i);
});

test("sanitizeBoardHtml preserves allowed legacy font formatting", () => {
  const clean = sanitizeBoardHtml(
    `<font color="#b42332" face="Georgia, 'Times New Roman', serif" size="5">x</font>`,
  );
  const { document } = parseHTML(`<div>${clean}</div>`);
  const span = document.querySelector("span");
  assert.ok(span);
  assert.match(span.getAttribute("style") ?? "", /color: #b42332/u);
  assert.match(
    span.getAttribute("style") ?? "",
    /font-family: Georgia, 'Times New Roman', serif/u,
  );
  assert.match(span.getAttribute("style") ?? "", /font-size: 1\.35rem/u);
});

test("sanitizeBoardHtml preserves browser-serialized double-quoted font families", () => {
  const clean = sanitizeBoardHtml(
    '<p style="font-family: Georgia, &quot;Times New Roman&quot;, serif">x</p>',
  );
  assert.match(
    clean,
    /font-family: Georgia, &quot;Times New Roman&quot;, serif/u,
  );
  assert.equal(sanitizeBoardHtml(clean), clean);
});

test("sanitizeBoardHtml is idempotent", () => {
  for (const dirty of [
    '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    '<p style="color: #b42332; font-size: 1.2rem">Ciao <em>mondo</em></p>',
    `<font color="#b42332" face="Georgia, 'Times New Roman', serif" size="5">x</font>`,
    '<p style="font-family: Georgia, &quot;Times New Roman&quot;, serif">x</p>',
  ]) {
    const clean = sanitizeBoardHtml(dirty);
    assert.equal(sanitizeBoardHtml(clean), clean);
  }
});

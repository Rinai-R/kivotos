import assert from "node:assert/strict";
import { test } from "node:test";
import { hidePeerOpenInApp, MARKERS, OPEN_CONTROL_ATTRIBUTES } from "../src/dsh/open-in-app.ts";

test("a peer page hides every host-local open control", () => {
  const css = hidePeerOpenInApp();
  for (const attribute of OPEN_CONTROL_ATTRIBUTES) {
    assert.ok(css.includes(`html[data-kivotos-peer] [${attribute}]`), `${attribute} is not hidden`);
  }
  assert.ok(css.endsWith("{display:none!important}"), css);
  // Each marker is a distinct bundle string the nightly check can find.
  assert.equal(new Set(MARKERS).size, MARKERS.length);
});

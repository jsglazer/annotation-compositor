import { describe, expect, it } from "vitest";
import {
  PAYLOAD_VERSION,
  decodeSettingsNote,
  encodeSettingsNote,
  samePrefs,
} from "../src/core/settingsNote.js";

const payload = {
  version: PAYLOAD_VERSION,
  updated: 1790130764841,
  prefs: {
    "extensions.zotero.annotationcompositor.tagPrefix": "grp",
    "extensions.zotero.annotationcompositor.libraryColorRules":
      '[{"color":"#ff6666","path":["A & B","<x>"]}]',
    "extensions.zotero.annotationcompositor.tagType": 0,
    "extensions.zotero.annotationcompositor.navigateOnClick": true,
  },
};

describe("settings note", () => {
  it("round-trips a payload, including characters HTML must escape", () => {
    expect(decodeSettingsNote(encodeSettingsNote(payload))).toEqual(payload);
  });

  it("survives the note editor wrapping the body and re-escaping quotes", () => {
    const edited = `<div data-schema-version="9">${encodeSettingsNote(payload).replace(
      /&quot;/g,
      '"',
    )}</div>`;
    expect(decodeSettingsNote(edited)).toEqual(payload);
  });

  it("rejects notes without a valid payload", () => {
    expect(decodeSettingsNote("<p>hello</p>")).toBeNull();
    expect(decodeSettingsNote("<pre>not json</pre>")).toBeNull();
    expect(
      decodeSettingsNote('<pre>{"version":99,"updated":1,"prefs":{}}</pre>'),
    ).toBeNull();
    expect(
      decodeSettingsNote('<pre>{"version":1,"updated":1,"prefs":[]}</pre>'),
    ).toBeNull();
  });

  it("compares pref maps by value, not key order", () => {
    expect(samePrefs({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
    expect(samePrefs({ a: 1 }, { a: 2 })).toBe(false);
    expect(samePrefs({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(samePrefs({ a: undefined }, { b: undefined })).toBe(false);
  });
});

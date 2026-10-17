import assert from "node:assert/strict";
import { test } from "node:test";
import { MARKERS, sessionFileAddress } from "../src/dsh/files.ts";

test("the Files action builds the address the document preview opens", () => {
  assert.equal(sessionFileAddress("s1", "notes/a.md"), "dsh-resource://file/session/s1/notes/a.md");
  assert.equal(
    sessionFileAddress("s 1", "./a b/c#d.txt"),
    "dsh-resource://file/session/s%201/a%20b/c%23d.txt",
  );
  // An absolute path keeps its leading separator as an empty segment; the
  // preview then reads it through the Session's filesystem.
  assert.equal(
    sessionFileAddress("s1", "/Users/me/a.mp3"),
    "dsh-resource://file/session/s1//Users/me/a.mp3",
  );
  // A drive letter keeps its colon, as dsh's own address builder does.
  assert.equal(
    sessionFileAddress("s1", "C:\\work\\a.wav"),
    "dsh-resource://file/session/s1/C:/work/a.wav",
  );
  assert.deepEqual(MARKERS, ["dsh-resource://file/session/"]);
});

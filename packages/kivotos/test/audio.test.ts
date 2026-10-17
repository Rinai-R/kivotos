import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIO_EXTENSIONS, audioMimeOf } from "../src/audio.ts";

test("every claimed audio suffix has a Blob type", () => {
  for (const suffix of AUDIO_EXTENSIONS) {
    assert.notEqual(audioMimeOf(`recording.${suffix}`), "", suffix);
  }
});

test("the audio MIME type follows the decoded file name", () => {
  assert.equal(audioMimeOf("voice.MP3"), "audio/mpeg");
  assert.equal(audioMimeOf("/runs/today/a b.flac"), "audio/flac");
  assert.equal(audioMimeOf("https://example.com/voice.ogg?download=1"), "audio/ogg");
  assert.equal(audioMimeOf("C:\\work\\voice.m4a"), "audio/mp4");
  // Unclaimed or missing suffixes keep dsh's unsupported state.
  assert.equal(audioMimeOf("voice.wma"), "");
  assert.equal(audioMimeOf("README"), "");
  assert.equal(audioMimeOf(""), "");
});

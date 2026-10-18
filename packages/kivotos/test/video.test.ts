import assert from "node:assert/strict";
import { test } from "node:test";
import { VIDEO_EXTENSIONS, videoMimeOf } from "../src/video.ts";

test("every claimed video suffix has a Blob type", () => {
  for (const suffix of VIDEO_EXTENSIONS) {
    assert.notEqual(videoMimeOf(`clip.${suffix}`), "", suffix);
  }
});

test("the video MIME type follows the decoded file name", () => {
  assert.equal(videoMimeOf("clip.MP4"), "video/mp4");
  assert.equal(videoMimeOf("/runs/today/a b.webm"), "video/webm");
  assert.equal(videoMimeOf("https://example.com/clip.mov?download=1"), "video/quicktime");
  assert.equal(videoMimeOf("C:\\work\\clip.m4v"), "video/x-m4v");
  // Unclaimed or missing suffixes keep dsh's unsupported state.
  assert.equal(videoMimeOf("clip.mkv"), "");
  assert.equal(videoMimeOf("README"), "");
  assert.equal(videoMimeOf(""), "");
});

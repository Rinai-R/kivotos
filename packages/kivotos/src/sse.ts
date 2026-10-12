/**
 * A Server-Sent Events reader for the attention streams: this Host reads its
 * peers' `/kivotos/events`, the client module reads `/kivotos/attention`.
 * No Node imports: `client.tsx` bundles it.
 */

/** One dispatched event. */
export interface SseEvent {
  /** The `event:` field, "message" when absent. */
  event: string;
  /** The `data:` lines joined with "\n". */
  data: string;
}

/**
 * Splits a text stream into events (WHATWG HTML, "Interpreting an event
 * stream"): lines end in CR, LF or CRLF, a blank line dispatches, comments
 * and unknown fields are skipped. Unlike `EventSource`, an event without
 * `data:` is still dispatched, so a bare marker event reaches the reader.
 */
export class SseReader {
  private buffer = "";
  private event = "";
  private data: string[] = [];
  /** A chunk ended in CR: a following LF belongs to the same line end. */
  private lastCr = false;

  /**
   * Feed decoded text.
   * @returns the events completed by this chunk, in order.
   */
  push(text: string): SseEvent[] {
    let input = text;
    if (this.lastCr && input.startsWith("\n")) input = input.slice(1);
    this.lastCr = input.endsWith("\r");
    this.buffer += input;
    const events: SseEvent[] = [];
    const ending = /\r\n|\r|\n/g;
    let start = 0;
    for (let match = ending.exec(this.buffer); match !== null; match = ending.exec(this.buffer)) {
      const event = this.line(this.buffer.slice(start, match.index));
      start = match.index + match[0].length;
      if (event !== undefined) events.push(event);
    }
    this.buffer = this.buffer.slice(start);
    return events;
  }

  private line(line: string): SseEvent | undefined {
    if (line === "") {
      if (this.event === "" && this.data.length === 0) return undefined;
      const event = { event: this.event || "message", data: this.data.join("\n") };
      this.event = "";
      this.data = [];
      return event;
    }
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    return undefined;
  }
}

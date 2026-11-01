/**
 * dsh 0.2.1-rc.5 in the desktop window, as a peer page hands dsh this
 * computer's file paths instead of the files themselves.
 *
 * The desktop shell's preload exposes `__DSH_HOST_PATHS__` to every document of
 * its own origin, and a peer mount is one (`dsh-app://app/kivotos/peer/<id>/`).
 * dsh's composer asks that bridge for a dropped or picked file's disk path and,
 * for a non-image file that has one, writes an `@path` reference into the draft
 * instead of uploading it (dsh-client-ui-conversation, `addFiles`). On the
 * serving computer the reference names a file the other machine does not have:
 * its session shows the reference, and the file never travels.
 *
 * A file that has to reach the other machine cannot be a reference, so a peer
 * page hands dsh a copy of the file that has no disk path — `pathFor` answers
 * "" for it and dsh takes its upload branch, whose route is relative and runs
 * through the peer mount. Images already upload, and a dropped directory keeps
 * dsh's own behavior; without the bridge (a plain browser, the phone app)
 * nothing here is installed.
 *
 * Files pasted from the clipboard are not covered: a synthetic paste event
 * cannot carry files.
 *
 * No Node imports: the Client bundle includes this module.
 */

/** The desktop preload's read-only host-file bridge. */
export const HOST_PATHS_BRIDGE = "__DSH_HOST_PATHS__";

/**
 * @returns the desktop shell's host-file bridge, if this page has one.
 */
export function hostPathBridge(): unknown {
  return Reflect.get(globalThis, HOST_PATHS_BRIDGE);
}

/** A copy of `file` that is not on this computer's disk (`pathFor` answers ""). */
function pathless(file: File): File {
  return new File([file], file.name, { type: file.type, lastModified: file.lastModified });
}

/**
 * Whether a transfer carries a directory, which keeps dsh's own behavior (a
 * directory cannot be uploaded as a file).
 * @param transfer - the drag's data.
 */
export function carriesDirectory(transfer: DataTransfer): boolean {
  return [...transfer.items].some(
    (item) => item.kind === "file" && item.webkitGetAsEntry()?.isDirectory === true,
  );
}

/**
 * Make this peer page's dropped and picked files upload to the machine the
 * page is served from.
 * @returns the cleanup; undefined when the page has no host-file bridge, which
 *   needs nothing.
 */
export function peerFileIntake(): (() => void) | undefined {
  if (hostPathBridge() === undefined) return undefined;
  // Events this module dispatches, so its own listening never runs twice.
  const ours = new WeakSet<Event>();

  const onDrop = (event: DragEvent): void => {
    const transfer = event.dataTransfer;
    if (ours.has(event) || transfer === null || !transfer.types.includes("Files")) return;
    if (carriesDirectory(transfer)) return;
    // dsh's drop listening is on `document`, in the bubble phase: stopping the
    // original here keeps the reference it would write; the copy below is the
    // same drop with pathless files, which it turns into uploads.
    event.preventDefault();
    event.stopPropagation();
    const copy = new DataTransfer();
    for (const file of transfer.files) copy.items.add(pathless(file));
    const forwarded = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: copy,
    });
    ours.add(forwarded);
    (event.target instanceof EventTarget ? event.target : document).dispatchEvent(forwarded);
  };

  // The attachment button's hidden file input: dsh reads `input.files` from its
  // own change listener, which runs after this capture one.
  const onChange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
    const files = input.files;
    if (files === null || files.length === 0) return;
    const copy = new DataTransfer();
    for (const file of files) copy.items.add(pathless(file));
    input.files = copy.files;
  };

  document.addEventListener("drop", onDrop, true);
  document.addEventListener("change", onChange, true);
  return () => {
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("change", onChange, true);
  };
}

process.on("message", (message) => {
  if (message?.type !== "kivotos_frame") return;
  process.send?.(message);
});

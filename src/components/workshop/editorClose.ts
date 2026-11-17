/** Closing is a UI action, not a second edit. Never trap the overlay on a save error. */
export function flushAndCloseEditor(
  current: string,
  saved: string,
  onChange: (value: string) => void,
  onClose: () => void,
): void {
  try {
    if (current !== saved) onChange(current);
  } finally {
    onClose();
  }
}

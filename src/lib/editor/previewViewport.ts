/** Fit the shared composition surface, not just its video, inside the available space. */
export function fitPreviewViewport(width: number, height: number, ratio: number): { width: number; height: number } {
  if (![width, height, ratio].every((n) => Number.isFinite(n) && n > 0)) {
    return { width: 0, height: 0 };
  }
  const fittedWidth = Math.min(width, height * ratio);
  return { width: fittedWidth, height: fittedWidth / ratio };
}

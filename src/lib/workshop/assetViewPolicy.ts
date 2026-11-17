/** Ads use their authored scene master, not a mandatory dramatic room A/B pair. */
export function useSpatialSceneViews(kind: string, workKind?: string): boolean {
  return kind === 'scene' && workKind !== 'product-ad';
}

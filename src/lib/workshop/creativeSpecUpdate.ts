import { STEP_ORDER, type WorkshopCreativeSpec, type WorkshopData, type WorkshopStepId } from './types.ts';

// Compare semantic values rather than object insertion order. Array order stays
// significant (in particular, the order of product reference images).
function signature(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  });
}

function creativeInputs(spec: WorkshopCreativeSpec | undefined) {
  if (!spec) return null;
  const { adSpec, ...creative } = spec;
  if (!adSpec) return creative;
  // Research receipts, DSH reference plans and image bindings are not script
  // edits. New creative fields remain conservative: they invalidate by default.
  const { materials: _materials, productImages: _images, researchMode: _mode, ...adCreative } = adSpec;
  return { ...creative, adSpec: adCreative };
}

/** Apply the same update in one state transition, without asserting completion. */
export function applyCreativeSpecUpdate(
  data: WorkshopData,
  creativeSpec: WorkshopCreativeSpec,
  now = Date.now(),
): WorkshopData {
  const productReferenceImages = creativeSpec.workKind === 'product-ad'
    ? creativeSpec.adSpec?.productImages ?? [] : [];
  const previousImages = data.creativeSpec?.workKind === 'product-ad'
    ? data.creativeSpec.adSpec?.productImages ?? [] : [];
  let invalidateFrom: WorkshopStepId | undefined;
  if (signature(creativeInputs(data.creativeSpec)) !== signature(creativeInputs(creativeSpec))) {
    invalidateFrom = 'script';
  } else if (signature(previousImages) !== signature(productReferenceImages)) {
    invalidateFrom = 'assets';
  }
  const steps = { ...data.steps };
  if (invalidateFrom) {
    for (const id of STEP_ORDER.slice(STEP_ORDER.indexOf(invalidateFrom) + 1)) {
      if (steps[id].status === 'done') steps[id] = { ...steps[id], status: 'stale', updatedAt: now };
    }
  }
  return {
    ...data,
    creativeSpec: { ...creativeSpec },
    shots: data.shots.map(shot => ({ ...shot, productReferenceImages })),
    steps,
  };
}

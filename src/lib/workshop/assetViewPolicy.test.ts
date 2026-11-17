import test from 'node:test';
import assert from 'node:assert/strict';
import { useSpatialSceneViews } from './assetViewPolicy.ts';
test('product ads keep their authored scene composition instead of forced square rooms', () => {
 assert.equal(useSpatialSceneViews('scene', 'product-ad'), false);
});
test('dramatic scenes retain A/B spatial views; props and characters do not get them', () => {
 assert.equal(useSpatialSceneViews('scene', undefined), true);
 assert.equal(useSpatialSceneViews('scene', 'short-drama'), true);
 assert.equal(useSpatialSceneViews('prop', 'short-drama'), false);
 assert.equal(useSpatialSceneViews('character', 'product-ad'), false);
});

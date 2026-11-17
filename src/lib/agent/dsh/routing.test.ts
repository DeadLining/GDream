import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
test('all composer requests require DSH and cannot run or fall back to builtin', () => {
 const source=read('../../../hooks/useAgent.ts');
 assert.doesNotMatch(source,/coordinator\.run\(|shouldFallbackHarnessToBuiltin|harnessBuiltinRoute|deepseekEngine/);
 assert.match(source,/if \(!usingHarness\)/);
 assert.match(source,/callbacks\.onError\(normalized\)/);
});
test('engine selector is removed, DSH is a visible noninteractive status', () => {
 const source=read('../../../components/chat/DeepseekHarnessControl.tsx');
 assert.doesNotMatch(source,/<button|setEngine|普通模式/);
 assert.match(source,/DSH/);
 const settings=read('../../../components/settings/ProviderSettings.tsx');
 assert.doesNotMatch(settings,/setDeepseekEngine|普通模式/);
});
test('legacy engine selection cannot survive settings rehydration', () => {
 const source=read('../../../stores/settingsStore.ts');
 assert.doesNotMatch(source,/setDeepseekEngine|deepseekEngine: 'harness' \| 'builtin'/);
 assert.match(source,/delete result\.deepseekEngine/);
});

test('context adapter cannot execute a legacy agent loop', () => {
 assert.doesNotMatch(read('../coordinator.ts'), /async run\(|streamToCompletion|glmClient\.streamChat/);
});

test('context adapter exposes no obsolete engine lifecycle or configuration', () => {
 const adapter = read('../coordinator.ts');
 assert.doesNotMatch(adapter, /getIsRunning|getCurrentCallbacks|getAbortController|parentAbortController|abortController|currentCallbacks|isRunning|maxTurns|abort\(\)/);
 const hook = read('../../../hooks/useAgent.ts');
 assert.doesNotMatch(hook, /coordinator\.getIsRunning|c\?\.abort|latestCoordinatorConfigRef|maxTurns/);
 assert.match(hook, /getSharedDshBridge\(agentId\)/);
 assert.doesNotMatch(read('../../../components/Settings.tsx'), /setMaxTurns|最大执行轮次/);
});

test('H3 native-image rewrites use the DSH auxiliary route, not the legacy provider loop', () => {
 const source = read('../../workshop/firstFrameRewriteChat.ts');
 assert.match(source, /quickChat\(messages/);
 assert.match(source, /mediaBlocks, workspaceScope: 'workshop'/);
 assert.doesNotMatch(source, /frameGroundedChat\(|referenceGroundedChat\(|getProvider|\.streamChat\(/);
});

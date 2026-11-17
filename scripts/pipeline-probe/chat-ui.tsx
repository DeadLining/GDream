// Isolated UI fixture. No application bootstrap, credentials, providers or generation tools.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
const w = window as any;
w.__TAURI_METADATA__ = { __currentWindow: { label: 'main' }, __windows: [] };
w.__TAURI_IPC__ = ({ callback, error, __tauriModule, message, cmd, path: privatePath, contents }: any) => {
  try {
    let result: any = null;
    if (cmd === 'write_text_file_private') {
      localStorage.setItem(`chat-fixture-disk:${privatePath}`, contents);
    } else if (__tauriModule === 'Fs') {
      const key = `chat-fixture-disk:${message.path}`;
      if (message.cmd === 'exists') result = localStorage.getItem(key) !== null;
      else if (message.cmd === 'readTextFile') result = localStorage.getItem(key);
      else if (message.cmd === 'removeFile') localStorage.removeItem(key);
      else if (message.cmd === 'writeFile') localStorage.setItem(key, new TextDecoder().decode(new Uint8Array(message.contents)));
      else if (message.cmd === 'renameFile') {
        localStorage.setItem(`chat-fixture-disk:${message.newPath}`, localStorage.getItem(`chat-fixture-disk:${message.oldPath}`)!);
        localStorage.removeItem(`chat-fixture-disk:${message.oldPath}`);
      } else if (message.cmd !== 'createDir') throw new Error(`Blocked filesystem call ${message.cmd}`);
    } else if (__tauriModule === 'Event') result = 1;
    else if (__tauriModule === 'Path') result = '/isolated-fixture';
    else if (cmd === 'plugin:clipboard-manager|write_text') result = null;
    queueMicrotask(() => w[`_${callback}`]?.(result));
  } catch (e) { w[`_${error}`]?.(String(e)); }
};
window.fetch = async () => { throw new Error('External requests forbidden in UI acceptance'); };
const [{ default: AgentDrawer }, { useChatStore }, { useRunStepStore }, { useAskUserStore }, { flushRunArchive }, { useSettingsStore }] = await Promise.all([
  import('../../src/components/chat/AgentDrawer'), import('../../src/stores/chatStore'), import('../../src/stores/runStepStore'),
  import('../../src/stores/askUserStore'), import('../../src/lib/chat/runArchive'), import('../../src/stores/settingsStore'),
]);
useSettingsStore.setState({ soundEnabled: false });
const request = '为产品广告设计方案，面向合作伙伴，突出三个真实功能。\n' + Array.from({length:16},(_,i)=>`要求 ${i+1}：保留产品原貌，引用可靠资料，不擅自提交付费生成。`).join('\n');
const generated = '[工坊上下文：隔离项目A，仅用于渲染验收]\n\n[一键全流程 · 广告方案]\n执行范围：2 个分镜\n关键要求：先确认，未授权不生成。\n'+ '系统执行规则：必须读取实际回执，禁止重放付费任务。\n'.repeat(25);
function show(session = 'fixture-A') {
  useChatStore.setState({ currentSessionId: session, activeView: 'workshop', streamingPhase:'idle', streamingContent:'',
    messages: JSON.parse(localStorage.getItem(`fixture-messages:${session}`) ?? '[]') });
}
function saveMessages(messages: any[]) {
  localStorage.setItem('fixture-messages:fixture-A',JSON.stringify(messages));
  useChatStore.setState({messages});
}
async function seed() {
  show();
  const time=Date.now();
  const messages = [{id:'manual',role:'user',content:request,timestamp:time-2},
    {id:'generated',role:'user',content:generated,metadata:{fullInput:generated},timestamp:time-1}];
  saveMessages(messages);
  const runId=useRunStepStore.getState().startRun({sessionId:'fixture-A',projectId:'fixture-project',userRequest:generated});
  const run=()=>useRunStepStore.getState();
  for(const [name,title] of [['web_search','搜索广告资料'],['workshop_set_shots','保存分镜方案']]) {
    run().beginToolBatch([{name,params:{query:'产品功能',shots:[{shotNo:'01'}]}}],runId);
    const id=run().startTool(name,{query:'产品功能'},runId);
    run().finishTool(id,true,{output:`${title}：实际成功回执\n资料和分镜已登记，没有生成媒体。`},runId);
    run().finishToolBatch([{name,success:true}],runId);
    run().addProgressUpdate(`${title}的过程说明，状态以工具回执为准。`,runId);
  }
  run().addOutcome({id:'fixture-shots',at:Date.now(),toolId:'saved',title:'已保存分镜方案',projectId:'fixture-project',summary:'已保存数据快照，不代表媒体已生成。',shots:[
    {shotNo:'01',description:'桌面展示产品，保留实体外观',durationSec:5,camera:'缓慢推进',dialogue:'让日常工作更简单',materials:['产品参考图：product-front.png','场景：办公桌']},
    {shotNo:'02',description:'近景演示软件功能',durationSec:7,camera:'固定近景',dialogue:'重要信息，一眼看清',materials:['用户上传截图：software.png']}]},runId);
  const answers=await useAskUserStore.getState().ask([{id:'scope',question:'方案已保存，接下来是否生成媒体？',context:'当前验收没有任何付费生成能力；这里只验证确认记录。',options:[{id:'no',label:'仅保留方案'},{id:'later',label:'稍后决定'}],multiSelect:false}],{sourceLabel:'隔离验收',sourceView:'workshop',sourceSessionId:'fixture-A'});
  run().finishRun('done',runId);
  saveMessages([...messages,{id:'final',role:'assistant',content:`本轮结束：2 个分镜已保存。决定：${answers?.[0]?.selected.join('、') ?? '取消'}。没有提交生成任务。`,timestamp:Date.now()+1,metadata:{runId}}]);
  await flushRunArchive();
}
function Fixture() {
  const [project,setProject]=React.useState('fixture-A');
  const [tone,setTone]=React.useState<'dark'|'light'>('dark');
  return <main style={{height:'100vh',color:'#bbb','--canvas-text-1':'#ddd','--canvas-text-2':'#aaa','--canvas-text-3':'#777','--canvas-node-border':'#333'} as React.CSSProperties}>
    <div style={{padding:24,maxWidth:450}}><h1>GDream Chat 隔离验收</h1><p>无模型调用、无真实项目、无付费提交</p>
    <div className="flex flex-col gap-3 mt-5">
      <button onClick={()=>setTone(tone==='dark'?'light':'dark')} className="border rounded p-2">切换外观（当前 {tone}）</button>
      <button onClick={()=>void seed()} className="border rounded p-2">开始长输入与多步骤验收</button>
      <button onClick={()=>{const next=project==='fixture-A'?'fixture-B':'fixture-A';setProject(next);show(next);}} className="border rounded p-2">切换项目（当前 {project}）</button>
      <button onClick={async()=>{await flushRunArchive();localStorage.removeItem('gdream-run-steps');location.reload();}} className="border rounded p-2">模拟重启（清空过程缓存）</button>
    </div></div>
    <AgentDrawer open onOpenChange={()=>{}} title="GDream · 渲染验收" stripPrefixRe={/^$/} greeting={{hello:'隔离项目',title:'暂无记录'}} suggestions={[]} onSend={()=>{}} onAbort={()=>{}} variant={tone} />
  </main>;
}
show();
createRoot(document.getElementById('root')!).render(<Fixture/>);

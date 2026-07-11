import {getProductionRun} from './api';import type {ProductionRun} from './types';
type Options={loadRun?:(id:string)=>Promise<ProductionRun>;sleep?:(ms:number)=>Promise<void>;signal?:AbortSignal};
const sleepDefault=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export async function pollProductionRun(runId:string,options:Options={}):Promise<ProductionRun>{const load=options.loadRun??getProductionRun;const sleep=options.sleep??sleepDefault;while(true){if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');const run=await load(runId);if(!['queued','running'].includes(run.status))return run;await sleep(1000);}}

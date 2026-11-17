import type { WsShot } from './types.ts';
import { deliveryReviewStatus } from './deliveryReviewStatus.ts';

interface PreviewIO {
  mkdir(path:string):Promise<void>;
  read(path:string):Promise<Uint8Array>;
  validate(bytes:Uint8Array):boolean;
  digest(bytes:Uint8Array):Promise<string>;
  writeBytes(path:string,bytes:Uint8Array):Promise<void>;
  writeText(path:string,text:string):Promise<void>;
}
/** A clearly labelled review-material bundle, never a substitute for final delivery. */
export async function exportPreviewBundle(input:{projectId:string;shots:WsShot[];directory:string;reviewerFingerprint?:string;io:PreviewIO}) {
  const available=input.shots.filter(s=>s.videoPath);
  if (!available.length) throw new Error('没有可导出的预览视频');
  const prepared=[];
  for (const [index,shot] of available.entries()) {
    const bytes=await input.io.read(shot.videoPath!);
    if (!input.io.validate(bytes)) throw new Error(`${shot.shotNo} 视频文件无效，未创建预览包`);
    prepared.push({shot,bytes,checksum:await input.io.digest(bytes),file:`${String(index+1).padStart(3,'0')}-${shot.shotNo.replace(/[^a-zA-Z0-9_-]/g,'_')}.mp4`});
  }
  await input.io.mkdir(input.directory);
  for (const item of prepared) await input.io.writeBytes(`${input.directory}/${item.file}`,item.bytes);
  const manifest={status:'internal-preview' as const,formalDelivery:false,projectId:input.projectId,generatedAt:Date.now(),
    warning:'内部预览素材包，非最终成片、非正式交付。视频可能尚未终审，禁止当作审核通过或商用授权证明。',
    missingShots:input.shots.filter(s=>!s.videoPath).map(s=>s.shotNo),
    shots:prepared.map(({shot,file,checksum})=>({shotNo:shot.shotNo,file,sourcePath:shot.videoPath,checksum,review:deliveryReviewStatus(shot,input.reviewerFingerprint)}))};
  await input.io.writeText(`${input.directory}/preview-manifest.json`,JSON.stringify(manifest,null,2));
  await input.io.writeText(`${input.directory}/README.txt`,manifest.warning+'\n\n'+manifest.shots.map(s=>`${s.shotNo}: ${s.review.label}`).join('\n'));
  return manifest;
}

export async function captureDirectorPreview(source:HTMLCanvasElement):Promise<Blob>{
  const scale=Math.min(1,1600/source.width,900/source.height);const width=Math.max(1,Math.round(source.width*scale));const height=Math.max(1,Math.round(source.height*scale));
  const target=document.createElement('canvas');target.width=width;target.height=height;const context=target.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('preview_context_unavailable');context.drawImage(source,0,0,width,height);
  const pixels=context.getImageData(0,0,width,height).data;let min=765,max=0;const stride=Math.max(4,Math.floor(pixels.length/12000/4)*4);for(let index=0;index<pixels.length;index+=stride){const value=pixels[index]+pixels[index+1]+pixels[index+2];min=Math.min(min,value);max=Math.max(max,value);}if(max-min<6)throw new Error('preview_is_blank');
  return new Promise((resolve,reject)=>target.toBlob(blob=>blob?resolve(blob):reject(new Error('preview_encode_failed')),'image/png'));
}

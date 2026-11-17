/** The decoded bytes, not a filename or data-URL label, define the wire format. */
export interface ReferenceInput {
  referenceImageUrls?: string[];
  referenceImageUrl?: string;
  referenceImageB64?: string;
}
type ReferenceLoader = (input: {referenceUrl?: string; referenceB64?: string}, compress: boolean) => Promise<Uint8Array>;

function describeImage(binary: Uint8Array) {
  const is = (offset: number, values: number[]) => values.every((v, i) => binary[offset+i] === v);
  const format = is(0, [137,80,78,71,13,10,26,10]) ? {mime:'image/png',ext:'png'}
    : is(0, [255,216,255]) ? {mime:'image/jpeg',ext:'jpg'}
    : is(0, [71,73,70,56]) ? {mime:'image/gif',ext:'gif'}
    : is(0, [82,73,70,70]) && is(8, [87,69,66,80]) ? {mime:'image/webp',ext:'webp'} : null;
  if (!format) throw new Error('参考图内容不是支持的 PNG/JPEG/GIF/WebP 图片');
  return {binary,...format};
}
function urls(params: ReferenceInput) {
  return params.referenceImageUrls?.length ? params.referenceImageUrls : params.referenceImageUrl ? [params.referenceImageUrl] : [];
}
function dataUrl(binary: Uint8Array, mime: string) {
  let encoded = '';
  for (let i=0; i<binary.length; i+=8192) encoded += String.fromCharCode(...binary.subarray(i,i+8192));
  return `data:${mime};base64,${btoa(encoded)}`;
}
export async function prepareEditReferences(params: ReferenceInput, load: ReferenceLoader, compress = false) {
  const refs: ReturnType<typeof describeImage>[] = [];
  for (const url of urls(params)) refs.push(describeImage(await load({referenceUrl:url}, compress)));
  if (params.referenceImageB64) refs.push(describeImage(await load({referenceB64:params.referenceImageB64}, compress)));
  return refs;
}
export async function prepareMinimaxReferences(params: ReferenceInput, load: ReferenceLoader, compress = false) {
  const refs: {type:'character';image_file:string}[] = [];
  const append = (binary: Uint8Array) => {
    const ref = describeImage(binary);
    if (!['image/jpeg','image/png'].includes(ref.mime)) throw new Error('MiniMax 参考图仅支持 JPEG 或 PNG，请转换图片后再提交');
    if (binary.length >= 10*1024*1024) throw new Error('MiniMax 参考图须小于 10 MB，请缩小图片后再提交');
    refs.push({type:'character',image_file:dataUrl(binary,ref.mime)});
  };
  for (const url of urls(params)) {
    if (!compress && /^https?:\/\//i.test(url)) refs.push({type:'character',image_file:url});
    else append(await load({referenceUrl:url},compress));
  }
  if (params.referenceImageB64) append(await load({referenceB64:params.referenceImageB64},compress));
  return refs;
}

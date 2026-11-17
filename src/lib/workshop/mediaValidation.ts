export interface VideoArtifactValidation {
  valid: boolean;
  reason?: string;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function hasPlayableIsoBmffStructure(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let hasFtyp = false;
  let hasMoov = false;
  let hasMediaData = false;
  while (offset + 8 <= bytes.byteLength) {
    const declaredSize = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const headerSize = declaredSize === 1 ? 16 : 8;
    if (declaredSize === 1 && offset + 16 > bytes.byteLength) return false;
    const boxSize = declaredSize === 1
      ? Number(view.getBigUint64(offset + 8))
      : declaredSize === 0 ? bytes.byteLength - offset : declaredSize;
    if (!Number.isSafeInteger(boxSize) || boxSize < headerSize || offset + boxSize > bytes.byteLength) return false;
    if (type === 'ftyp') hasFtyp = true;
    if (type === 'moov') hasMoov = true;
    if (type === 'mdat') hasMediaData = true;
    offset += boxSize;
    if (declaredSize === 0) break;
  }
  return offset === bytes.byteLength && hasFtyp && hasMoov && hasMediaData;
}

export function validateVideoArtifact(bytes: Uint8Array): VideoArtifactValidation {
  if (bytes.byteLength < 12) return { valid: false, reason: '文件过小，无法识别为视频容器' };
  if (ascii(bytes, 4, 4) === 'ftyp') {
    return hasPlayableIsoBmffStructure(bytes)
      ? { valid: true }
      : { valid: false, reason: 'MP4/MOV 缺少完整的 ftyp、moov 或 mdat 数据块' };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { valid: true };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'AVI ') return { valid: true };
  return { valid: false, reason: '文件不是可识别的 MP4/MOV、WebM 或 AVI 视频容器' };
}

/** Deterministic native file I/O: export must not depend on shell Python discovery. */
export async function writeRenderTextFile(path: string, contents: string, fs: {
  mkdir: (path: string) => Promise<void>;
  write: (path: string, contents: string) => Promise<void>;
  read: (path: string) => Promise<string>;
}): Promise<void> {
  const parent = path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  if (!parent) throw new Error('导出文件需要绝对目录');
  await fs.mkdir(parent);
  await fs.write(path, contents);
  if (await fs.read(path) !== contents) throw new Error('导出临时文件写盘校验失败');
}

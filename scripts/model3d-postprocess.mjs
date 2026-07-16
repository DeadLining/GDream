import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const TOOL_VERSION = '4.4.1';
const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  throw new Error('usage: model3d-postprocess.mjs <input.glb> <output.glb>');
}

const logger = new Logger(Logger.Verbosity.SILENT);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(logger);
const document = await io.read(inputPath);
document.setLogger(logger);

const root = document.getRoot();
const protectedRig =
  root.listSkins().length > 0 ||
  root.listAnimations().length > 0 ||
  root
    .listMeshes()
    .some((mesh) => mesh.listPrimitives().some((primitive) => primitive.listTargets().length > 0));

const steps = ['dedup', 'prune'];
const transforms = [
  dedup({ keepUniqueNames: true }),
  prune({ keepAttributes: true }),
];

if (!protectedRig) {
  transforms.push(
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.5,
      error: 0.001,
      lockBorder: true,
    }),
  );
  steps.push('weld', 'simplify');
}

transforms.push(textureCompress({ encoder: sharp, resize: [2048, 2048] }));
steps.push('texture_compress');

await document.transform(...transforms);
await io.write(outputPath, document);

process.stdout.write(
  JSON.stringify({
    tool: 'gltf-transform',
    version: TOOL_VERSION,
    protected_rig: protectedRig,
    steps,
    simplify_ratio: protectedRig ? null : 0.5,
    simplify_error: protectedRig ? null : 0.001,
    texture_max_size: 2048,
  }),
);

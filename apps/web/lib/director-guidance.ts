import {BasicDepthPacking,Box3,Color,MeshBasicMaterial,MeshDepthMaterial,Vector3 as ThreeVector3,type Camera,type Material,type Object3D,type Scene} from 'three';
import {captureDirectorPreview} from './director-preview';
import {HUMANOID_BONES,mapHumanoidBoneName,type HumanoidBoneId} from './director-humanoid';
import type {DirectorGuidanceKind} from './types';

export type {DirectorGuidanceKind} from './types';
export type DirectorGuidanceCapture=(kind:DirectorGuidanceKind)=>Promise<Blob>;

type RendererLike={domElement:Pick<HTMLCanvasElement,'width'|'height'>;render:(scene:Scene,camera:Camera)=>void};

const shouldHideFromGuidance=(object:Object3D)=>{
  const stageKind=object.name.startsWith('director-object-')?object.userData.kind:null;
  return stageKind==='background'||stageKind==='light'||object.name==='director-ground'||'isGridHelper' in object||'isLine' in object||'isPoints' in object;
};

const hideGuidanceExclusions=(scene:Scene)=>{
  const visibility=new Map<Object3D,boolean>();
  scene.traverse(object=>{
    if(!shouldHideFromGuidance(object))return;
    visibility.set(object,object.visible);object.visible=false;
  });
  return visibility;
};

const restoreVisibility=(visibility:Map<Object3D,boolean>)=>{
  for(const [object,visible] of visibility)object.visible=visible;
};

const fitDepthClipping=(scene:Scene,camera:Camera)=>{
  if(!('near' in camera&&'far' in camera&&'updateProjectionMatrix' in camera))return null;
  const clippingCamera=camera as Camera&{near:number;far:number;updateProjectionMatrix:()=>void};
  scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const bounds=new Box3();
  scene.traverse(object=>{
    if(object.name.startsWith('director-object-')&&!shouldHideFromGuidance(object)&&object.visible)bounds.expandByObject(object);
  });
  if(bounds.isEmpty())return null;
  const depths:number[]=[];
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
    const depth=-new ThreeVector3(x,y,z).applyMatrix4(camera.matrixWorldInverse).z;
    if(Number.isFinite(depth)&&depth>0)depths.push(depth);
  }
  if(!depths.length)return null;
  const previous={near:clippingCamera.near,far:clippingCamera.far};
  const minimum=Math.min(...depths);const maximum=Math.max(...depths);
  const padding=Math.max(.05,(maximum-minimum)*.15);
  clippingCamera.near=Math.max(.01,minimum-padding);
  clippingCamera.far=Math.max(clippingCamera.near+.1,maximum+padding);
  clippingCamera.updateProjectionMatrix();
  return()=>{clippingCamera.near=previous.near;clippingCamera.far=previous.far;clippingCamera.updateProjectionMatrix();};
};

export async function captureDirectorSilhouette({scene,camera,renderer,capture=captureDirectorPreview}:{scene:Scene;camera:Camera;renderer:RendererLike;capture?:(canvas:HTMLCanvasElement)=>Promise<Blob>}):Promise<Blob>{
  const background=scene.background;
  const visibility=hideGuidanceExclusions(scene);
  const materials=new Map<Object3D,Material|Material[]>();
  const silhouetteMaterial=new MeshBasicMaterial({color:'#000000'});
  scene.traverse(object=>{
    if('isMesh' in object&&object.isMesh&&'material' in object){
      const mesh=object as Object3D&{material:Material|Material[]};
      materials.set(object,mesh.material);mesh.material=silhouetteMaterial;
    }
  });
  scene.background=new Color('#ffffff');
  try{
    renderer.render(scene,camera);
    return await capture(renderer.domElement as HTMLCanvasElement);
  }finally{
    for(const [object,material] of materials)(object as Object3D&{material:Material|Material[]}).material=material;
    restoreVisibility(visibility);
    scene.background=background;
    renderer.render(scene,camera);
    silhouetteMaterial.dispose();
  }
}

export async function captureDirectorDepth({scene,camera,renderer,capture=captureDirectorPreview}:{scene:Scene;camera:Camera;renderer:RendererLike;capture?:(canvas:HTMLCanvasElement)=>Promise<Blob>}):Promise<Blob>{
  const background=scene.background;
  const overrideMaterial=scene.overrideMaterial;
  const visibility=hideGuidanceExclusions(scene);
  const depthMaterial=new MeshDepthMaterial({depthPacking:BasicDepthPacking});
  const restoreClipping=fitDepthClipping(scene,camera);
  const depthCamera=camera as Camera&{near?:number;far?:number;isOrthographicCamera?:boolean};
  const depthNear=depthCamera.near??.1;const depthFar=depthCamera.far??1000;
  const viewZFunction=depthCamera.isOrthographicCamera?'orthographicDepthToViewZ':'perspectiveDepthToViewZ';
  depthMaterial.onBeforeCompile=shader=>{
    shader.uniforms.directorDepthNear={value:depthNear};shader.uniforms.directorDepthFar={value:depthFar};
    shader.fragmentShader=shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      `float directorViewZ = ${viewZFunction}( fragCoordZ, directorDepthNear, directorDepthFar );
      float directorLinearDepth = viewZToOrthographicDepth( directorViewZ, directorDepthNear, directorDepthFar );
      gl_FragColor = vec4( vec3( 1.0 - directorLinearDepth ), opacity );`,
    ).replace(
      '#include <packing>',
      '#include <packing>\nuniform float directorDepthNear;\nuniform float directorDepthFar;',
    );
  };
  depthMaterial.customProgramCacheKey=()=>`director-linear-depth-${viewZFunction}`;
  scene.background=new Color('#000000');scene.overrideMaterial=depthMaterial;
  try{
    renderer.render(scene,camera);
    return await capture(renderer.domElement as HTMLCanvasElement);
  }finally{
    restoreClipping?.();
    scene.overrideMaterial=overrideMaterial;
    restoreVisibility(visibility);
    scene.background=background;
    renderer.render(scene,camera);
    depthMaterial.dispose();
  }
}

export async function captureDirectorObjectMask({scene,camera,renderer,capture=captureDirectorPreview}:{scene:Scene;camera:Camera;renderer:RendererLike;capture?:(canvas:HTMLCanvasElement)=>Promise<Blob>}):Promise<Blob>{
  const background=scene.background;
  const visibility=hideGuidanceExclusions(scene);
  const materials=new Map<Object3D,Material|Material[]>();
  const maskMaterials:MeshBasicMaterial[]=[];
  const roots:Object3D[]=[];
  scene.traverse(object=>{if(object.name.startsWith('director-object-')&&!shouldHideFromGuidance(object)&&object.visible)roots.push(object);});
  roots.forEach((root,index)=>{
    const color=new Color().setHSL((index*.61803398875)%1,.78,.55);
    const maskMaterial=new MeshBasicMaterial({color,toneMapped:false});maskMaterials.push(maskMaterial);
    root.traverse(object=>{
      if(!('isMesh' in object&&object.isMesh&&'material' in object))return;
      const mesh=object as Object3D&{material:Material|Material[]};materials.set(object,mesh.material);mesh.material=maskMaterial;
    });
  });
  scene.background=new Color('#000000');
  try{
    renderer.render(scene,camera);
    return await capture(renderer.domElement as HTMLCanvasElement);
  }finally{
    for(const [object,material] of materials)(object as Object3D&{material:Material|Material[]}).material=material;
    restoreVisibility(visibility);
    scene.background=background;
    renderer.render(scene,camera);
    maskMaterials.forEach(material=>material.dispose());
  }
}

const normalizedBone=(object:Object3D):HumanoidBoneId|null=>{
  if(object.name.startsWith('humanoid-bone-')){
    const id=object.name.slice('humanoid-bone-'.length) as HumanoidBoneId;
    return HUMANOID_BONES.some(item=>item.id===id)?id:null;
  }
  return mapHumanoidBoneName(object.name);
};

const encodePng=(canvas:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('guidance_encode_failed')),'image/png'));

export async function renderDirectorSkeletonGuidance(scene:Scene,camera:Camera,sourceWidth:number,sourceHeight:number):Promise<Blob>{
  const scale=Math.min(1,1600/sourceWidth,900/sourceHeight);
  const width=Math.max(1,Math.round(sourceWidth*scale));
  const height=Math.max(1,Math.round(sourceHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('guidance_context_unavailable');
  context.fillStyle='#05090c';context.fillRect(0,0,width,height);
  scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const parentById=new Map(HUMANOID_BONES.map(item=>[item.id,item.parent]));
  const palette=['#63e6ff','#ffd166','#ff7aa2','#b8f36b'];
  let renderedLines=0;
  let characterIndex=0;
  for(const root of scene.children.flatMap(child=>{
    const matches:Object3D[]=[];child.traverse(item=>{if(item.name.startsWith('director-object-')&&item.visible)matches.push(item);});return matches;
  })){
    const nodes=new Map<HumanoidBoneId,Object3D>();
    root.traverse(object=>{const id=normalizedBone(object);if(id&&!nodes.has(id))nodes.set(id,object);});
    if(nodes.size<2)continue;
    const points=new Map<HumanoidBoneId,{x:number;y:number}>();
    for(const [id,node] of nodes){
      const projected=node.getWorldPosition(new ThreeVector3()).project(camera);
      if(projected.z<-1||projected.z>1)continue;
      points.set(id,{x:(projected.x*.5+.5)*width,y:(-.5*projected.y+.5)*height});
    }
    const color=palette[characterIndex%palette.length];characterIndex+=1;
    context.strokeStyle=color;context.lineWidth=Math.max(2,width/420);context.lineCap='round';
    for(const [id,point] of points){
      let parent=parentById.get(id)??null;
      while(parent&&!points.has(parent))parent=parentById.get(parent)??null;
      const parentPoint=parent?points.get(parent):null;
      if(!parentPoint)continue;
      context.beginPath();context.moveTo(parentPoint.x,parentPoint.y);context.lineTo(point.x,point.y);context.stroke();renderedLines+=1;
    }
    context.fillStyle=color;
    for(const point of points.values()){
      context.beginPath();context.arc(point.x,point.y,Math.max(3,width/300),0,Math.PI*2);context.fill();
    }
  }
  if(renderedLines===0)throw new Error('skeleton_guidance_unavailable');
  return encodePng(canvas);
}

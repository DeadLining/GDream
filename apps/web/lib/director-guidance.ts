import {Color,MeshBasicMaterial,Vector3 as ThreeVector3,type Camera,type Material,type Object3D,type Scene} from 'three';
import {captureDirectorPreview} from './director-preview';
import {HUMANOID_BONES,mapHumanoidBoneName,type HumanoidBoneId} from './director-humanoid';

export type DirectorGuidanceKind='silhouette'|'skeleton_pose';
export type DirectorGuidanceCapture=(kind:DirectorGuidanceKind)=>Promise<Blob>;

type RendererLike={domElement:Pick<HTMLCanvasElement,'width'|'height'>;render:(scene:Scene,camera:Camera)=>void};

export async function captureDirectorSilhouette({scene,camera,renderer,capture=captureDirectorPreview}:{scene:Scene;camera:Camera;renderer:RendererLike;capture?:(canvas:HTMLCanvasElement)=>Promise<Blob>}):Promise<Blob>{
  const background=scene.background;
  const visibility=new Map<Object3D,boolean>();
  const materials=new Map<Object3D,Material|Material[]>();
  const silhouetteMaterial=new MeshBasicMaterial({color:'#000000'});
  scene.traverse(object=>{
    const isStageObject=object.name.startsWith('director-object-');
    if(isStageObject&&(object.userData.kind==='background'||object.userData.kind==='light')){
      visibility.set(object,object.visible);object.visible=false;
    }
    if(object.name==='director-ground'||'isGridHelper' in object||'isLine' in object||'isPoints' in object){
      visibility.set(object,object.visible);object.visible=false;
    }
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
    for(const [object,visible] of visibility)object.visible=visible;
    scene.background=background;
    renderer.render(scene,camera);
    silhouetteMaterial.dispose();
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

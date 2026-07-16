import {Color,Group,Mesh,MeshDepthMaterial,MeshStandardMaterial,PerspectiveCamera,Scene,SphereGeometry} from 'three';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {captureDirectorDepth,captureDirectorObjectMask,captureDirectorSilhouette,renderDirectorSkeletonGuidance} from '../lib/director-guidance';

describe('director guidance capture',()=>{
  afterEach(()=>vi.restoreAllMocks());

  it('temporarily renders visible stage objects as a black silhouette and restores the scene',async()=>{
    const scene=new Scene();
    const object=new Group();object.name='director-object-character-1';object.userData={kind:'character'};
    const material=new MeshStandardMaterial({color:'#ff0000'});
    const mesh=new Mesh(new SphereGeometry(1),material);object.add(mesh);scene.add(object);
    const renderer={domElement:{width:800,height:600},render:vi.fn()};
    const capture=vi.fn(async()=>{
      expect(mesh.material).not.toBe(material);
      expect((mesh.material as {color:{getHexString:()=>string}}).color.getHexString()).toBe('000000');
      return new Blob(['png'],{type:'image/png'});
    });

    const blob=await captureDirectorSilhouette({scene,camera:new PerspectiveCamera(),renderer,capture});

    expect(blob.type).toBe('image/png');
    expect(mesh.material).toBe(material);
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it('projects normalized humanoid joints into a nonblank skeleton pose PNG',async()=>{
    const scene=new Scene();
    const object=new Group();object.name='director-object-character-1';object.userData={kind:'character'};
    const hips=new Group();hips.name='humanoid-bone-Hips';hips.position.set(0,1,0);
    const chest=new Group();chest.name='humanoid-bone-Chest';chest.position.set(0,.5,0);
    const head=new Group();head.name='humanoid-bone-Head';head.position.set(0,.5,0);
    object.add(hips);hips.add(chest);chest.add(head);scene.add(object);
    const calls:{lineTo:number;arc:number}={lineTo:0,arc:0};
    const context={fillStyle:'',strokeStyle:'',lineWidth:0,lineCap:'',fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(()=>calls.lineTo++),stroke:vi.fn(),arc:vi.fn(()=>calls.arc++),fill:vi.fn()};
    const target={width:0,height:0,getContext:vi.fn(()=>context),toBlob:(callback:(blob:Blob|null)=>void)=>callback(new Blob(['png'],{type:'image/png'}))};
    vi.spyOn(document,'createElement').mockReturnValue(target as unknown as HTMLCanvasElement);
    const camera=new PerspectiveCamera(50,4/3,.1,100);camera.position.set(0,1.5,5);camera.lookAt(0,1.5,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();

    const blob=await renderDirectorSkeletonGuidance(scene,camera,800,600);

    expect(blob.type).toBe('image/png');
    expect(calls.lineTo).toBeGreaterThan(0);
    expect(calls.arc).toBeGreaterThanOrEqual(3);
  });

  it('renders foreground geometry with a depth material and restores the scene',async()=>{
    const scene=new Scene();scene.background=new Color('#123456');
    const object=new Group();object.name='director-object-character-1';object.userData={kind:'character'};
    const material=new MeshStandardMaterial({color:'#ff0000'});object.add(new Mesh(new SphereGeometry(1),material));scene.add(object);
    const renderer={domElement:{width:800,height:600},render:vi.fn()};
    const camera=new PerspectiveCamera(50,4/3,.1,1000);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const capture=vi.fn(async()=>{
      expect(scene.overrideMaterial).toBeInstanceOf(MeshDepthMaterial);
      expect((scene.background as Color).getHexString()).toBe('000000');
      expect(camera.near).toBeGreaterThan(.1);expect(camera.far).toBeLessThan(1000);
      return new Blob(['depth'],{type:'image/png'});
    });

    const blob=await captureDirectorDepth({scene,camera,renderer,capture});

    expect(blob.type).toBe('image/png');
    expect(scene.overrideMaterial).toBeNull();
    expect((scene.background as Color).getHexString()).toBe('123456');
    expect(camera.near).toBe(.1);expect(camera.far).toBe(1000);
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it('assigns a distinct flat color to each foreground object mask and restores materials',async()=>{
    const scene=new Scene();
    const first=new Group();first.name='director-object-character-1';first.userData={kind:'character'};
    const second=new Group();second.name='director-object-prop-1';second.userData={kind:'prop'};
    const firstMaterial=new MeshStandardMaterial({color:'#ff0000'});const secondMaterial=new MeshStandardMaterial({color:'#00ff00'});
    const firstMesh=new Mesh(new SphereGeometry(1),firstMaterial);const secondMesh=new Mesh(new SphereGeometry(1),secondMaterial);
    first.add(firstMesh);second.add(secondMesh);scene.add(first,second);
    const renderer={domElement:{width:800,height:600},render:vi.fn()};
    const capture=vi.fn(async()=>{
      const firstColor=(firstMesh.material as {color:{getHexString:()=>string}}).color.getHexString();
      const secondColor=(secondMesh.material as {color:{getHexString:()=>string}}).color.getHexString();
      expect(firstColor).not.toBe('000000');expect(secondColor).not.toBe('000000');expect(firstColor).not.toBe(secondColor);
      return new Blob(['mask'],{type:'image/png'});
    });

    const blob=await captureDirectorObjectMask({scene,camera:new PerspectiveCamera(),renderer,capture});

    expect(blob.type).toBe('image/png');
    expect(firstMesh.material).toBe(firstMaterial);expect(secondMesh.material).toBe(secondMaterial);
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });
});

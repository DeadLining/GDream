import {Group,Mesh,MeshStandardMaterial,PerspectiveCamera,Scene,SphereGeometry} from 'three';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {captureDirectorSilhouette,renderDirectorSkeletonGuidance} from '../lib/director-guidance';

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
});

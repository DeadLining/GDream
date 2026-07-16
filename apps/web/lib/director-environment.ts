export type DirectorGroundStyle='grid'|'solid'|'none';

export type DirectorEnvironmentSettings={
  background_color:string;
  ground:DirectorGroundStyle;
  ground_color:string;
  ambient_light:number;
  key_light_color:string;
  key_light_intensity:number;
};

const color=(value:unknown,fallback:string)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:fallback;
const intensity=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(3,value)):fallback;

export function resolveDirectorEnvironment(environment:Record<string,unknown>):DirectorEnvironmentSettings{
  return {
    background_color:color(environment.background_color,'#263238'),
    ground:environment.ground==='solid'||environment.ground==='none'?environment.ground:'grid',
    ground_color:color(environment.ground_color,'#40545c'),
    ambient_light:intensity(environment.ambient_light,.85),
    key_light_color:color(environment.key_light_color,'#ffffff'),
    key_light_intensity:intensity(environment.key_light_intensity,1.4),
  };
}

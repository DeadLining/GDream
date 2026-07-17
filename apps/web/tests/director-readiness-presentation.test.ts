import {describe,expect,it} from 'vitest';
import {directorNodePresentation} from '../lib/director-readiness-presentation';

describe('directorNodePresentation',()=>{
  it('locks the director workflow until the project has a current script',()=>{
    expect(directorNodePresentation({
      director_ready:false,
      director_asset_ready:false,
      director_blocking_ready:false,
      director_camera_ready:false,
      director_blockers:['current_script_revision_missing'],
    })).toEqual({
      blocked:true,
      blockedReason:'请先创建或导入剧本',
      complete:false,
      statusLabel:'已锁定',
      detail:'请先创建或导入剧本',
    });
  });

  it('keeps incomplete director setup actionable once a script exists',()=>{
    expect(directorNodePresentation({
      director_ready:false,
      director_asset_ready:true,
      director_blocking_ready:true,
      director_camera_ready:false,
      director_blockers:['director_preview_missing'],
    })).toEqual({
      blocked:false,
      blockedReason:null,
      complete:false,
      statusLabel:'待完成',
      detail:'缺少预览',
    });
  });

  it('marks fully prepared director setup as complete',()=>{
    expect(directorNodePresentation({
      director_ready:true,
      director_asset_ready:true,
      director_blocking_ready:true,
      director_camera_ready:true,
      director_blockers:[],
    })).toEqual({
      blocked:false,
      blockedReason:null,
      complete:true,
      statusLabel:'已就绪',
      detail:'资产、站位和预览已保存',
    });
  });
});

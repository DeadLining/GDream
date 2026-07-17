type DirectorReadiness = {
  director_ready?: boolean;
  director_asset_ready?: boolean;
  director_blocking_ready?: boolean;
  director_camera_ready?: boolean;
  director_blockers?: string[];
};

export function directorNodePresentation(readiness:DirectorReadiness){
  if((readiness.director_blockers??[]).includes('current_script_revision_missing')){
    return{
      blocked:true,
      blockedReason:'请先创建或导入剧本',
      complete:false,
      statusLabel:'已锁定',
      detail:'请先创建或导入剧本',
    };
  }
  const missing=[
    !readiness.director_asset_ready&&'资产',
    !readiness.director_blocking_ready&&'站位',
    !readiness.director_camera_ready&&'预览',
  ].filter((item):item is string=>Boolean(item));
  return{
    blocked:false,
    blockedReason:null,
    complete:Boolean(readiness.director_ready),
    statusLabel:readiness.director_ready?'已就绪':'待完成',
    detail:readiness.director_ready?'资产、站位和预览已保存':missing.length?`缺少${missing.join('、')}`:'导演设置尚未完成',
  };
}

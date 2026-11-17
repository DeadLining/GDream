use chrono::Local;
use std::fs;
use std::process::Command as StdCommand;

/// 数据目录名：品牌从 Kunpeng 更名为 GDream 后，用户数据落在 `~/.gdream`。
pub const DATA_DIR_NAME: &str = ".gdream";
/// 更名前的数据目录名。启动时补缺式复制到新目录（旧目录保留）。
pub const LEGACY_DATA_DIR_NAME: &str = ".kunpeng";
/// 迁移完成标记：放在新目录里，内容为旧目录名，便于以后再加一次更名。
const MIGRATION_MARKER_NAME: &str = ".migrated-from-kunpeng";

/// 返回数据目录（`~/.gdream`），不保证存在。
pub fn data_dir() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(DATA_DIR_NAME))
}

/// 一次性数据目录迁移：`~/.kunpeng` → `~/.gdream`。
///
/// 语义与 localStorage 迁移一致——**复制、不移动、不清源**：
///   · 用「标记文件」判定是否迁移过，而不是「新目录是否存在」——新目录会被
///     内置资源部署逻辑提前创建，用它判定会永久跳过迁移；
///   · 补缺式复制（`overwrite = false`）：只补旧目录里新目录没有的文件，
///     绝不覆盖用户在新版里已经产生的数据；
///   · 文件优先硬链接（同卷瞬时、零额外空间），跨卷/失败回退字节复制；
///   · 旧目录永远保留，用户可随时退回旧版本；
///   · 任一步失败都静默降级，下次启动重试，不阻断应用启动。
pub fn migrate_legacy_data_dir() -> bool {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return false,
    };
    let legacy = home.join(LEGACY_DATA_DIR_NAME);
    let next = home.join(DATA_DIR_NAME);
    if !legacy.exists() {
        return false; // 全新用户：没有旧数据可迁移
    }
    let marker = next.join(MIGRATION_MARKER_NAME);
    if marker.exists() {
        return false; // 已迁移过
    }
    if let Err(err) = copy_tree_fill(&legacy, &next) {
        // 半成品目录不清掉：补缺式复制天然可重入，下次启动继续补即可。
        eprintln!(
            "[migrate] {} → {} 未完成，下次启动重试: {}",
            legacy.display(),
            next.display(),
            err
        );
        return false;
    }
    rename_legacy_files(&next);
    // 标记写入成功才算迁移完成，否则下次启动重来一次（补缺式，幂等）。
    if let Err(err) = fs::write(&marker, LEGACY_DATA_DIR_NAME) {
        eprintln!("[migrate] 写入迁移标记失败，下次启动重试: {}", err);
        return false;
    }
    true
}

/// 补缺式递归复制：只写目标端不存在的文件，已存在的一律保留。
fn copy_tree_fill(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_tree_fill(&from, &to)?;
        } else if ty.is_file() && !to.exists() {
            if fs::hard_link(&from, &to).is_err() {
                fs::copy(&from, &to)?;
            }
        }
        // 已存在的文件 / 符号链接等：保留目标端现状。
    }
    Ok(())
}

/// 数据目录里只有少数**文件名**带旧品牌，逐条改成新名，
/// 这样其余代码只需要认识 `~/.gdream/gdream.json` 一种路径。
///
/// 目前只有一处：RunningHub key 文件 `kunpeng.json` → `gdream.json`
/// （syncRunninghubKeyFile / runninghub.py 的标准读取位置）。
fn rename_legacy_files(root: &std::path::Path) {
    let pairs: [(&str, &str); 1] = [("kunpeng.json", "gdream.json")];
    for (old_name, new_name) in pairs {
        let from = root.join(old_name);
        let to = root.join(new_name);
        if from.is_file() && !to.exists() {
            // 迁移必须保持旧目录可回退：不要 move/rename 源文件。
            // 同卷优先硬链接，失败时回退字节复制；旧文件始终保留。
            if fs::hard_link(&from, &to).is_err() {
                if let Err(err) = fs::copy(&from, &to) {
                    eprintln!(
                        "[migrate] {} → {} 复制失败（不影响启动）: {}",
                        from.display(),
                        to.display(),
                        err
                    );
                }
            }
        }
    }
}

/// 获取用户主目录
#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot find home directory".to_string())
}

/// Write text with owner-only permissions (0600 on unix). Used for
/// credential-bearing files (settings.json, image_api_slots.json, bot
/// credentials) so other local users cannot read API keys.
pub(crate) fn write_file_private(path: &std::path::Path, contents: &str) -> Result<(), String> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| format!("写入失败: {}", e))?;
    file.write_all(contents.as_bytes())
        .map_err(|e| format!("写入失败: {}", e))?;
    // Truncating an existing file keeps its old mode; force 0600 explicitly.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Frontend-facing variant of write_file_private, restricted to paths inside
/// the user's home directory. Accepts relative paths (resolved against home).
#[tauri::command]
pub fn write_text_file_private(
    path: String, contents: String, expected_contents: Option<String>, check_existing: Option<bool>,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户目录".to_string())?;
    let raw = std::path::PathBuf::from(&path);
    let target = if raw.is_absolute() { raw } else { home.join(raw) };
    if !target.starts_with(&home) {
        return Err("私密文件写入仅允许用户主目录内的路径".to_string());
    }
    if check_existing.unwrap_or(false) {
        if target != home.join(".gdream/settings.json") {
            return Err("安全设置写入只允许标准设置路径".into());
        }
        return crate::settings_storage::write_checked_private(&target, &contents, expected_contents.as_deref());
    }
    write_file_private(&target, &contents)
}

/// 获取系统临时目录（跨平台：macOS/Linux=/tmp，Windows=%TEMP%）
/// 用于替换前端硬编码的 "/tmp" 路径，使应用可在 Windows 上运行。
#[tauri::command]
pub fn get_temp_dir() -> Result<String, String> {
    Ok(std::env::temp_dir().to_string_lossy().to_string())
}

/// 获取本地文件大小。前端据此决定媒体是直接内联，还是先上传到对象存储。
#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    fs::metadata(&path)
        .map(|metadata| metadata.len())
        .map_err(|e| format!("Failed to read file metadata: {}", e))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileMetadata {
    size: u64,
    modified_ms: u64,
}

/// 获取稳定的本地文件指纹字段，避免路径相同但内容已替换时误用旧分析缓存。
#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<LocalFileMetadata, String> {
    let metadata =
        fs::metadata(&path).map_err(|e| format!("Failed to read file metadata: {}", e))?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);
    Ok(LocalFileMetadata {
        size: metadata.len(),
        modified_ms,
    })
}

/// 用系统 open 命令打开文件或在 Finder 中显示
/// reveal=true 时传 -R 参数（在 Finder 中选中文件）
#[tauri::command]
pub fn open_path(path: String, reveal: Option<bool>) -> Result<(), String> {
    let mut cmd = StdCommand::new("open");
    if reveal.unwrap_or(false) {
        cmd.arg("-R");
    }
    cmd.arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open path: {}", e))?;
    Ok(())
}

/// Scan ~/.gdream/skills/ directory and return subdirectory names
#[tauri::command]
pub fn scan_skills_dir() -> Result<Vec<String>, String> {
    let skills_dir = dirs::home_dir()
        .map(|h| h.join(format!("{}/skills", DATA_DIR_NAME)))
        .ok_or_else(|| "Cannot find home directory".to_string())?;

    if !skills_dir.exists() {
        fs::create_dir_all(&skills_dir)
            .map_err(|e| format!("Failed to create skills directory: {}", e))?;
        return Ok(vec![]);
    }

    let mut dirs = vec![];
    let entries =
        fs::read_dir(&skills_dir).map_err(|e| format!("Failed to read skills directory: {}", e))?;

    for entry in entries {
        if let Ok(entry) = entry {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    dirs.push(name.to_string());
                }
            }
        }
    }

    Ok(dirs)
}

/// 创建今日工作区目录 (~/.gdream/workspace/YYYY-MM-DD/) 及子目录
/// 返回今日工作区的绝对路径
#[tauri::command]
pub fn ensure_workspace() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;

    let today = Local::now().format("%Y-%m-%d").to_string();
    let workspace_day = home.join(format!("{}/workspace", DATA_DIR_NAME)).join(&today);

    for sub in &["images", "code", "docs", "videos"] {
        let dir = workspace_day.join(sub);
        if !dir.exists() {
            fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create workspace dir: {}", e))?;
        }
    }

    Ok(workspace_day.to_string_lossy().to_string())
}

/// 弹出系统"另存为"对话框，将源文件（本地路径或 HTTP URL）保存到用户选中的位置。
/// 返回保存路径（用户取消则返回 None）。
#[tauri::command]
pub async fn save_file_dialog(
    window: tauri::Window,
    source_path: String,
    default_name: String,
) -> Result<Option<String>, String> {
    use tauri::api::dialog::FileDialogBuilder;

    // Pick a filter from the extension
    let ext = default_name
        .rsplit('.')
        .next()
        .unwrap_or("png")
        .to_lowercase();
    let (filter_name, filter_exts): (&str, &[&str]) = match ext.as_str() {
        "mp4" => ("视频", &["mp4"]),
        "mov" => ("视频", &["mov"]),
        "webm" => ("视频", &["webm"]),
        "m4v" => ("视频", &["m4v"]),
        "mp3" => ("音频", &["mp3"]),
        "wav" => ("音频", &["wav"]),
        "m4a" => ("音频", &["m4a"]),
        "ogg" | "opus" => ("音频", &["ogg", "opus"]),
        "pcm" => ("音频", &["pcm"]),
        "jpg" | "jpeg" => ("图片", &["jpg", "jpeg"]),
        "webp" => ("图片", &["webp"]),
        "gif" => ("图片", &["gif"]),
        _ => ("图片", &["png"]),
    };

    let (tx, rx) = tokio::sync::oneshot::channel::<Option<std::path::PathBuf>>();
    FileDialogBuilder::new()
        .set_parent(&window)
        .set_file_name(&default_name)
        .add_filter(filter_name, filter_exts)
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let dest = rx.await.map_err(|_| "dialog cancelled".to_string())?;
    let dest = match dest {
        Some(p) => p,
        None => return Ok(None),
    };

    // Resolve source: strip asset:// protocol to get the local path.
    let resolved = if source_path.starts_with("data:") {
        // data: URI (e.g. canvas crops) — decode base64 payload and write.
        let payload = source_path
            .splitn(2, ";base64,")
            .nth(1)
            .ok_or_else(|| "不支持的 data: URI（仅支持 base64 编码）".to_string())?;
        let bytes = base64_decode(payload).map_err(|e| format!("base64 解码失败: {}", e))?;
        fs::write(&dest, &bytes).map_err(|e| format!("写入失败: {}", e))?;
        return Ok(Some(dest.to_string_lossy().to_string()));
    } else if source_path.starts_with("https://asset.localhost/") {
        percent_decode_str(source_path.trim_start_matches("https://asset.localhost/"))
    } else if source_path.starts_with("asset://localhost/") {
        percent_decode_str(source_path.trim_start_matches("asset://localhost/"))
    } else if source_path.starts_with("http://") || source_path.starts_with("https://") {
        // Remote URL — download to dest directly
        let response = reqwest::get(&source_path)
            .await
            .map_err(|e| format!("下载失败: {}", e))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("下载失败 HTTP {}", status));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("读取失败: {}", e))?;
        fs::write(&dest, &bytes).map_err(|e| format!("写入失败: {}", e))?;
        return Ok(Some(dest.to_string_lossy().to_string()));
    } else {
        source_path.clone()
    };

    let source = std::path::Path::new(&resolved);
    if !source.is_file() {
        return Err(format!("视频源文件不存在或不可读: {}", resolved));
    }
    fs::copy(source, &dest)
        .map_err(|e| format!("复制失败: {} → {}: {}", resolved, dest.display(), e))?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

fn percent_decode_str(s: &str) -> String {
    use std::borrow::Cow;
    let decoded: Cow<str> = urlencoding::decode(s).unwrap_or(Cow::Borrowed(s));
    decoded.to_string()
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct FileMeta {
    pub path: String,
    pub size: u64,
    pub mtime_ms: u64,
}

/// Recursively list files under `path` with size + mtime, capped at
/// `max_entries` (default 5000). One IPC round-trip instead of per-file
/// stat calls from the WebView — used by the artifact library scanner.
#[tauri::command]
pub fn scan_dir_meta(path: String, max_entries: Option<usize>) -> Result<Vec<FileMeta>, String> {
    let cap = max_entries.unwrap_or(5000);
    let root = std::path::PathBuf::from(&path);
    if !root.exists() {
        return Ok(vec![]);
    }

    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(dir) = stack.pop() {
        if out.len() >= cap {
            break;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if out.len() >= cap {
                break;
            }
            let p = entry.path();
            // Skip hidden files/dirs (.DS_Store etc.)
            if p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with('.'))
                .unwrap_or(false)
            {
                continue;
            }
            if p.is_dir() {
                stack.push(p);
            } else if let Ok(meta) = entry.metadata() {
                let mtime_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                out.push(FileMeta {
                    path: p.to_string_lossy().to_string(),
                    size: meta.len(),
                    mtime_ms,
                });
            }
        }
    }
    Ok(out)
}

// ─── Bundled resource deployment (AGENT.md / skills / aigc-memory seeds) ───
//
// On startup, if the bundled app version differs from ~/.gdream/.bundled-version,
// overwrite AGENT.md + skills/ from the bundle and seed aigc-memory (fill-only,
// never overwrites existing files — user project data lives there).
fn copy_dir_recursive(
    src: &std::path::Path,
    dst: &std::path::Path,
    overwrite: bool,
) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &to, overwrite)?;
        } else if overwrite || !to.exists() {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

pub fn deploy_bundled_resources(app: &tauri::AppHandle) {
    let version = app.package_info().version.to_string();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let data_root = home.join(DATA_DIR_NAME);
    let marker = data_root.join(".bundled-version");

    let installed = std::fs::read_to_string(&marker).unwrap_or_default();
    if installed.trim() == version {
        return; // 同版本：不覆盖，保留用户对 skills/AGENT.md 的手改
    }

    let resource_dir = match app.path_resolver().resource_dir() {
        Some(d) => d,
        None => return,
    };
    // Tauri 1.x 通常把 ../xxx 映射到 resource_dir/_up_/xxx；部分平台和
    // 开发构建会直接放在 resource_dir 下，启动时同时兼容两种布局。
    let mapped = resource_dir.join("_up_");
    let up = if mapped.join("skills").exists() {
        mapped
    } else {
        resource_dir.clone()
    };

    let _ = std::fs::create_dir_all(&data_root);
    let mut deployment_ok = true;

    // AGENT.md：版本变更时覆盖（大小写两份都写，历史上两种都被引用过）
    let agent_src = up.join("AGENT.md");
    if agent_src.exists() {
        if let Err(error) = std::fs::copy(&agent_src, data_root.join("AGENT.md")) {
            eprintln!("[resources] failed to deploy AGENT.md: {}", error);
            deployment_ok = false;
        }
        if let Err(error) = std::fs::copy(&agent_src, data_root.join("agent.md")) {
            eprintln!("[resources] failed to deploy agent.md: {}", error);
            deployment_ok = false;
        }
    }

    // skills/：版本变更时整体覆盖（同名文件覆盖，不删用户新增的 skill）
    let skills_src = up.join("skills");
    if skills_src.exists() {
        if let Err(error) = copy_dir_recursive(&skills_src, &data_root.join("skills"), true) {
            eprintln!("[resources] failed to deploy bundled skills: {}", error);
            deployment_ok = false;
        }
    } else {
        eprintln!(
            "[resources] bundled skills directory is missing: {}",
            skills_src.display()
        );
        deployment_ok = false;
    }

    // aigc-memory/：种子数据只补缺失，绝不覆盖（内含用户项目数据）
    let memory_src = up.join("aigc-memory");
    if memory_src.exists() {
        let _ = copy_dir_recursive(&memory_src, &data_root.join("aigc-memory"), false);
    }
    // style-library/ 是内置风格库，版本变更时强制覆盖（index.json 含 DNA 字段更新）
    let style_lib_src = up.join("aigc-memory").join("style-library");
    if style_lib_src.exists() {
        let _ = copy_dir_recursive(
            &style_lib_src,
            &data_root.join("aigc-memory").join("style-library"),
            true,
        );
    }

    // 只有关键资源完整覆盖后才写版本标记。失败时下次启动会自动重试，
    // 避免另一台电脑停留在“部分新 Skill + 部分旧 Skill”的状态。
    if deployment_ok {
        if let Err(error) = std::fs::write(&marker, &version) {
            eprintln!("[resources] failed to write deployment marker: {}", error);
        }
    }
}

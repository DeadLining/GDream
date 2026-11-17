//! Credential settings: compare-and-swap under a process-shared lock, then
//! atomic owner-only replacement. Never include contents in error messages.
use std::{fs, io::Write, path::Path};

pub fn write_checked_private(
    path: &Path,
    contents: &str,
    expected: Option<&str>,
) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(contents).map_err(|_| "设置格式无效")?;
    if !parsed.get("state").is_some_and(|v| v.is_object()) {
        return Err("设置格式无效".into());
    }
    let parent = path.parent().ok_or("设置目录无效")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建设置目录")?;
    let mut opts = fs::OpenOptions::new();
    opts.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        opts.share_mode(0);
    }
    let lock = opts
        .open(parent.join(".settings.lock"))
        .map_err(|_| "无法锁定设置")?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        // Nonblocking: fail closed instead of freezing startup/IPC.
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("设置正在由另一实例保存，请重启后重试".into());
        }
    }

    // The open lock descriptor stays alive until this function returns.
    let _lock_guard = lock;
    let current = match fs::read_to_string(path) {
        Ok(value) => Some(value),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err("无法读取现有设置，已阻止覆盖".into()),
    };
    if current.as_deref() != expected {
        return Err("设置已被另一实例修改，已阻止覆盖".into());
    }
    let tmp = parent.join(format!(
        ".settings-{}-{}.tmp",
        std::process::id(),
        rand::random::<u64>()
    ));
    let result = (|| -> Result<(), String> {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp).map_err(|_| "无法创建安全设置文件")?;
        file.write_all(contents.as_bytes())
            .map_err(|_| "无法写入设置")?;
        file.sync_all().map_err(|_| "无法同步设置")?;
        fs::rename(&tmp, path).map_err(|_| "无法替换设置文件")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(
                std::env::temp_dir()
                    .join(format!("gdream-settings-test-{}", rand::random::<u64>())),
            )
        }
        fn path(&self) -> std::path::PathBuf {
            self.0.join("settings.json")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    const FIRST: &str = r#"{"state":{"credentials":[{"id":"fixture"}]},"version":44}"#;
    const DELETED: &str = r#"{"state":{"credentials":[]},"version":44}"#;
    #[test]
    fn checked_write_preserves_external_changes_and_explicit_deletion() {
        let f = Fixture::new();
        write_checked_private(&f.path(), FIRST, None).unwrap();
        assert!(write_checked_private(&f.path(), DELETED, None).is_err());
        assert_eq!(fs::read_to_string(f.path()).unwrap(), FIRST);
        write_checked_private(&f.path(), DELETED, Some(FIRST)).unwrap();
        assert!(write_checked_private(&f.path(), FIRST, Some(FIRST)).is_err());
        assert_eq!(fs::read_to_string(f.path()).unwrap(), DELETED);
    }
    #[test]
    fn checked_write_rejects_invalid_envelope_and_keeps_permissions() {
        let f = Fixture::new();
        write_checked_private(&f.path(), FIRST, None).unwrap();
        assert!(write_checked_private(&f.path(), "{fixture-secret", Some(FIRST)).is_err());
        assert_eq!(fs::read_to_string(f.path()).unwrap(), FIRST);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(f.path(), fs::Permissions::from_mode(0o644)).unwrap();
            write_checked_private(&f.path(), DELETED, Some(FIRST)).unwrap();
            assert_eq!(
                fs::metadata(f.path()).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert!(!fs::read_dir(&f.0).unwrap().any(|p| p
            .unwrap()
            .path()
            .extension()
            .is_some_and(|e| e == "tmp")));
    }
    #[cfg(unix)]
    #[test]
    fn checked_write_refuses_competing_writer() {
        use std::os::fd::AsRawFd;
        let f = Fixture::new();
        write_checked_private(&f.path(), FIRST, None).unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(f.0.join(".settings.lock"))
            .unwrap();
        assert_eq!(
            unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
            0
        );
        assert!(write_checked_private(&f.path(), DELETED, Some(FIRST)).is_err());
        assert_eq!(fs::read_to_string(f.path()).unwrap(), FIRST);
    }
}

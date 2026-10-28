//! Saves the workspace (tabs, layout, settings) in the app data directory.

use std::path::Path;

use idlehub_core::account::AccountStore;
use idlehub_core::workspace::Workspace;

const WORKSPACE_FILE: &str = "workspace.json";
const LEGACY_ACCOUNTS_FILE: &str = "accounts.json";

/// Reads the saved workspace, migrating the accounts-only file of older versions.
pub fn load_workspace(data_dir: &Path) -> Workspace {
    let read = |file| std::fs::read_to_string(data_dir.join(file)).ok();
    let saved = read(WORKSPACE_FILE).and_then(|json| match Workspace::from_json(&json) {
        Ok(workspace) => Some(workspace),
        Err(error) => {
            // Set the damaged file aside: the next save would overwrite it.
            let path = data_dir.join(WORKSPACE_FILE);
            let kept = data_dir.join(format!("{WORKSPACE_FILE}.corrupt"));
            eprintln!(
                "idlehub: unreadable {}: {error}; kept as {}",
                path.display(),
                kept.display()
            );
            let _ = std::fs::rename(path, kept);
            None
        }
    });
    saved.unwrap_or_else(|| {
        let store = read(LEGACY_ACCOUNTS_FILE)
            .and_then(|json| AccountStore::from_json(&json).ok())
            .unwrap_or_default();
        Workspace::new(store)
    })
}

/// Writes to a temporary file first so a crash never leaves a half-written workspace.
pub fn save_workspace(data_dir: &Path, workspace: &Workspace) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let tmp = data_dir.join(format!("{WORKSPACE_FILE}.tmp"));
    std::fs::write(&tmp, workspace.to_json())?;
    std::fs::rename(tmp, data_dir.join(WORKSPACE_FILE))
}

/// Applies `change` to a copy, saves it and only then replaces `workspace`, so a
/// change is either rejected, or applied and on disk.
pub fn commit(
    data_dir: &Path,
    workspace: &mut Workspace,
    change: impl FnOnce(&mut Workspace) -> Result<(), String>,
) -> Result<(), String> {
    let mut next = workspace.clone();
    change(&mut next)?;
    save_workspace(data_dir, &next).map_err(|error| format!("could not save the tabs: {error}"))?;
    *workspace = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A fresh directory under the system temp dir, removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "idlehub-{name}-{}-{}",
                std::process::id(),
                idlehub_core::account::AccountId::new()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn workspace_with(labels: &[&str]) -> Workspace {
        let mut ws = Workspace::default();
        for label in labels {
            ws.add(label, None).unwrap();
        }
        ws
    }

    #[test]
    fn starts_empty_without_saved_files() {
        let dir = TempDir::new("empty");
        assert_eq!(load_workspace(&dir.0), Workspace::default());
    }

    #[test]
    fn saved_workspaces_load_back() {
        let dir = TempDir::new("round-trip");
        let ws = workspace_with(&["A", "B"]);
        save_workspace(&dir.0, &ws).unwrap();
        assert_eq!(load_workspace(&dir.0), ws);
        assert!(!dir.0.join("workspace.json.tmp").exists());
    }

    #[test]
    fn creates_the_data_directory_on_first_save() {
        let dir = TempDir::new("nested");
        let nested = dir.0.join("a").join("b");
        save_workspace(&nested, &workspace_with(&["A"])).unwrap();
        assert!(nested.join(WORKSPACE_FILE).exists());
    }

    #[test]
    fn migrates_the_accounts_file_of_older_versions() {
        let dir = TempDir::new("legacy");
        let ws = workspace_with(&["Old"]);
        std::fs::write(dir.0.join(LEGACY_ACCOUNTS_FILE), ws.store().to_json()).unwrap();
        assert_eq!(load_workspace(&dir.0).store(), ws.store());
    }

    /// A data dir that cannot be created: its parent is a file.
    fn unwritable(dir: &TempDir) -> PathBuf {
        let blocker = dir.0.join("blocker");
        std::fs::write(&blocker, "").unwrap();
        blocker.join("data")
    }

    #[test]
    fn changes_are_kept_once_saved() {
        let dir = TempDir::new("commit");
        let mut ws = Workspace::default();
        commit(&dir.0, &mut ws, |ws| {
            ws.add("A", None).map(drop).map_err(|e| e.to_string())
        })
        .unwrap();
        assert_eq!(ws.store().accounts().len(), 1);
        assert_eq!(load_workspace(&dir.0), ws);
    }

    #[test]
    fn a_change_that_cannot_be_saved_is_rolled_back() {
        // Otherwise the app would run a tab the UI was told failed, and lose it on restart.
        let dir = TempDir::new("unsaved");
        let mut ws = workspace_with(&["A"]);
        let before = ws.clone();
        let result = commit(&unwritable(&dir), &mut ws, |ws| {
            ws.add("B", None).map(drop).map_err(|e| e.to_string())
        });
        assert!(result.is_err());
        assert_eq!(ws, before);
    }

    #[test]
    fn a_rejected_change_leaves_the_workspace_alone() {
        let dir = TempDir::new("rejected");
        let mut ws = workspace_with(&["A"]);
        let before = ws.clone();
        let result = commit(&dir.0, &mut ws, |ws| {
            ws.add("B", None).unwrap();
            Err("nope".to_owned())
        });
        assert_eq!(result, Err("nope".to_owned()));
        assert_eq!(ws, before);
        assert!(!dir.0.join(WORKSPACE_FILE).exists());
    }

    #[test]
    fn keeps_an_unreadable_workspace_instead_of_overwriting_it() {
        // A damaged file would otherwise be replaced by an empty workspace on
        // the next save, losing every tab for good.
        let dir = TempDir::new("corrupt");
        std::fs::write(dir.0.join(WORKSPACE_FILE), "{ not json").unwrap();

        assert_eq!(load_workspace(&dir.0), Workspace::default());
        save_workspace(&dir.0, &Workspace::default()).unwrap();

        let kept = std::fs::read_to_string(dir.0.join("workspace.json.corrupt")).unwrap();
        assert_eq!(kept, "{ not json");
    }
}

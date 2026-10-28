//! User-facing text produced by the shell (pt-BR, like the UI in `src/strings.ts`).

pub fn active_tabs(count: usize) -> String {
    if count == 1 {
        "1 aba ativa".to_owned()
    } else {
        format!("{count} abas ativas")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_active_tabs_in_portuguese() {
        assert_eq!(active_tabs(1), "1 aba ativa");
        assert_eq!(active_tabs(4), "4 abas ativas");
        assert_eq!(active_tabs(0), "0 abas ativas");
    }
}

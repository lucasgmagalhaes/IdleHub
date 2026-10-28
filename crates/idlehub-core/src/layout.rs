//! Computes where each account webview is placed inside the window.

/// Axis-aligned rectangle in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

/// How the accounts share the available area.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewMode {
    /// Every account gets an equal cell of a near-square grid.
    Grid,
    /// The account at this index takes the main area; the others shrink into a
    /// side rail so they stay visible (and therefore are never paused).
    Focused(usize),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LayoutOptions {
    /// Space between cells, in logical pixels.
    pub gap: f64,
    /// Fraction of the width used by the side rail in focused mode.
    pub rail_ratio: f64,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        Self {
            gap: 4.0,
            rail_ratio: 0.2,
        }
    }
}

/// Returns one rectangle per account, in account order.
pub fn compute_layout(
    area: Rect,
    count: usize,
    mode: ViewMode,
    options: LayoutOptions,
) -> Vec<Rect> {
    match mode {
        ViewMode::Focused(index) if index < count && count > 1 => {
            focused(area, count, index, options)
        }
        _ => grid(area, count, options.gap),
    }
}

fn grid(area: Rect, count: usize, gap: f64) -> Vec<Rect> {
    if count == 0 {
        return Vec::new();
    }
    let cols = (count as f64).sqrt().ceil() as usize;
    let rows = count.div_ceil(cols);
    let cell_width = cell_size(area.width, cols, gap);
    let cell_height = cell_size(area.height, rows, gap);
    (0..count)
        .map(|i| {
            let (row, col) = (i / cols, i % cols);
            Rect::new(
                area.x + col as f64 * (cell_width + gap),
                area.y + row as f64 * (cell_height + gap),
                cell_width,
                cell_height,
            )
        })
        .collect()
}

fn focused(area: Rect, count: usize, index: usize, options: LayoutOptions) -> Vec<Rect> {
    let rail_width = area.width * options.rail_ratio;
    let main = Rect::new(
        area.x,
        area.y,
        (area.width - rail_width - options.gap).max(0.0),
        area.height,
    );
    let rail = Rect::new(
        area.x + area.width - rail_width,
        area.y,
        rail_width,
        area.height,
    );
    let others = count - 1;
    let item_height = cell_size(rail.height, others, options.gap);
    let mut rail_slot = 0;
    (0..count)
        .map(|i| {
            if i == index {
                return main;
            }
            let y = rail.y + rail_slot as f64 * (item_height + options.gap);
            rail_slot += 1;
            Rect::new(rail.x, y, rail.width, item_height)
        })
        .collect()
}

/// Size of one of `parts` cells sharing `total` with `gap` between them.
fn cell_size(total: f64, parts: usize, gap: f64) -> f64 {
    ((total - gap * (parts as f64 - 1.0)) / parts as f64).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect::new(0.0, 0.0, 1000.0, 800.0);

    fn no_gap() -> LayoutOptions {
        LayoutOptions {
            gap: 0.0,
            ..LayoutOptions::default()
        }
    }

    #[test]
    fn empty_layout_has_no_rects() {
        assert!(compute_layout(AREA, 0, ViewMode::Grid, no_gap()).is_empty());
    }

    #[test]
    fn single_account_fills_the_area() {
        assert_eq!(
            compute_layout(AREA, 1, ViewMode::Grid, no_gap()),
            vec![AREA]
        );
    }

    #[test]
    fn four_accounts_form_a_two_by_two_grid() {
        let rects = compute_layout(AREA, 4, ViewMode::Grid, no_gap());
        assert_eq!(
            rects,
            vec![
                Rect::new(0.0, 0.0, 500.0, 400.0),
                Rect::new(500.0, 0.0, 500.0, 400.0),
                Rect::new(0.0, 400.0, 500.0, 400.0),
                Rect::new(500.0, 400.0, 500.0, 400.0),
            ]
        );
    }

    #[test]
    fn two_accounts_split_side_by_side() {
        let rects = compute_layout(AREA, 2, ViewMode::Grid, no_gap());
        assert_eq!(
            rects,
            vec![
                Rect::new(0.0, 0.0, 500.0, 800.0),
                Rect::new(500.0, 0.0, 500.0, 800.0)
            ]
        );
    }

    #[test]
    fn three_accounts_use_a_two_by_two_grid_with_an_empty_cell() {
        let rects = compute_layout(AREA, 3, ViewMode::Grid, no_gap());
        assert_eq!(rects.len(), 3);
        assert_eq!(rects[2], Rect::new(0.0, 400.0, 500.0, 400.0));
    }

    #[test]
    fn grid_respects_area_offset_and_gap() {
        let area = Rect::new(10.0, 50.0, 1004.0, 804.0);
        let options = LayoutOptions {
            gap: 4.0,
            ..LayoutOptions::default()
        };
        let rects = compute_layout(area, 4, ViewMode::Grid, options);
        assert_eq!(rects[0], Rect::new(10.0, 50.0, 500.0, 400.0));
        assert_eq!(rects[3], Rect::new(514.0, 454.0, 500.0, 400.0));
    }

    #[test]
    fn focused_account_takes_main_area_and_others_go_to_the_rail() {
        let rects = compute_layout(AREA, 4, ViewMode::Focused(1), no_gap());
        assert_eq!(rects[1], Rect::new(0.0, 0.0, 800.0, 800.0));
        let rail: Vec<Rect> = [0, 2, 3].iter().map(|&i| rects[i]).collect();
        assert_eq!(
            rail,
            vec![
                Rect::new(800.0, 0.0, 200.0, 800.0 / 3.0),
                Rect::new(800.0, 800.0 / 3.0, 200.0, 800.0 / 3.0),
                Rect::new(800.0, 1600.0 / 3.0, 200.0, 800.0 / 3.0),
            ]
        );
    }

    #[test]
    fn focusing_the_only_account_fills_the_area() {
        assert_eq!(
            compute_layout(AREA, 1, ViewMode::Focused(0), no_gap()),
            vec![AREA]
        );
    }

    #[test]
    fn focusing_an_unknown_index_falls_back_to_grid() {
        assert_eq!(
            compute_layout(AREA, 4, ViewMode::Focused(9), no_gap()),
            compute_layout(AREA, 4, ViewMode::Grid, no_gap())
        );
    }

    #[test]
    fn rects_never_have_negative_size() {
        let tiny = Rect::new(0.0, 0.0, 2.0, 2.0);
        let options = LayoutOptions {
            gap: 10.0,
            ..LayoutOptions::default()
        };
        for mode in [ViewMode::Grid, ViewMode::Focused(0)] {
            for r in compute_layout(tiny, 4, mode, options) {
                assert!(r.width >= 0.0 && r.height >= 0.0, "{r:?}");
            }
        }
    }
}

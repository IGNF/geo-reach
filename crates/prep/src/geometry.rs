//! Geometry shared by the roads and the public transport.

/// Douglas-Peucker on a flat list of points, keeps the ends
pub fn simplify(p: &[f64], tolerance: f64) -> Vec<f64> {
    let n = p.len() / 2;
    if n <= 2 {
        return p.to_vec();
    }
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;
    let mut stack = vec![(0, n - 1)];
    while let Some((s, e)) = stack.pop() {
        let (x0, y0, x1, y1) = (p[s * 2], p[s * 2 + 1], p[e * 2], p[e * 2 + 1]);
        let len = (x1 - x0).hypot(y1 - y0);
        let len = if len == 0.0 { 1.0 } else { len };
        let (mut best, mut best_d) = (0, tolerance);
        for k in s + 1..e {
            let d = ((x1 - x0) * (y0 - p[k * 2 + 1]) - (x0 - p[k * 2]) * (y1 - y0)).abs() / len;
            if d > best_d {
                best = k;
                best_d = d;
            }
        }
        if best > 0 {
            keep[best] = true;
            stack.push((s, best));
            stack.push((best, e));
        }
    }
    p.chunks(2)
        .zip(&keep)
        .filter(|(_, k)| **k)
        .flat_map(|(c, _)| c.iter().copied())
        .collect()
}

use engine::{Engine, NONE};

/// 0 → 1 → 2, and a slower 0 → 2
fn line() -> Engine {
    let mut e = Engine::default();
    e.reserve(3, 3, 1);
    e.offsets.copy_from_slice(&[0, 2, 3, 3]);
    e.heads.copy_from_slice(&[1, 2, 2]);
    e.costs.copy_from_slice(&[10.0, 50.0, 10.0]);
    e.arc_edge.copy_from_slice(&[7, 8, 9]);
    e
}

#[test]
fn shortest_times_and_path() {
    let mut e = line();
    e.src_nodes[0] = 0;
    e.src_costs[0] = 5.0;
    assert_eq!(e.run(1, 1000.0), 3);
    assert_eq!(e.dist, vec![5.0, 15.0, 25.0]);
    assert_eq!((e.pred_node[2], e.pred_edge[2]), (1, 9));
}

#[test]
fn bound_and_reset_between_runs() {
    let mut e = line();
    e.src_nodes[0] = 0;
    e.src_costs[0] = 0.0;
    e.run(1, 12.0);
    assert!(e.dist[2].is_infinite());
    e.src_nodes[0] = 2;
    e.run(1, 100.0);
    assert_eq!(e.dist[2], 0.0);
    assert!(e.dist[0].is_infinite() && e.dist[1].is_infinite());
    assert_eq!(e.pred_node[1], NONE);
}

#[test]
fn several_sources_keep_the_best_start() {
    let mut e = line();
    e.reserve(3, 3, 2);
    e.offsets.copy_from_slice(&[0, 2, 3, 3]);
    e.heads.copy_from_slice(&[1, 2, 2]);
    e.costs.copy_from_slice(&[10.0, 50.0, 10.0]);
    e.src_nodes.copy_from_slice(&[0, 2]);
    e.src_costs.copy_from_slice(&[0.0, 3.0]);
    e.run(2, 1000.0);
    assert_eq!(e.dist, vec![0.0, 10.0, 3.0]);
}

/// A start cost that is not a number (0 × ∞ when the cursor sits at the end of a one-way street) is ignored: it used to
/// spread NaN around the cycles of the graph forever
#[test]
fn not_a_number_start_is_ignored() {
    let mut e = Engine::default();
    // 0 ⇄ 1
    e.reserve(2, 2, 2);
    e.offsets.copy_from_slice(&[0, 1, 2]);
    e.heads.copy_from_slice(&[1, 0]);
    e.costs.copy_from_slice(&[10.0, 10.0]);
    e.arc_edge.copy_from_slice(&[0, 1]);
    e.src_nodes.copy_from_slice(&[0, 1]);
    e.src_costs.copy_from_slice(&[f32::NAN, 3.0]);
    assert_eq!(e.run(2, 1000.0), 2);
    assert_eq!(e.dist, vec![13.0, 3.0]);
}

//! The graph of one profile and the bounded multi-source Dijkstra over it.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// No predecessor, or unreachable
pub const NONE: u32 = u32::MAX;

#[derive(Default)]
pub struct Engine {
    /// Arcs of node `n` are `offsets[n]..offsets[n + 1]`
    pub offsets: Vec<u32>,
    /// Head node of each arc
    pub heads: Vec<u32>,
    /// Cost of each arc, in seconds
    pub costs: Vec<f32>,
    /// Road section of each arc, to rebuild a path
    pub arc_edge: Vec<u32>,
    pub src_nodes: Vec<u32>,
    pub src_costs: Vec<f32>,
    /// Shortest time of each node, `f32::INFINITY` beyond the bound
    pub dist: Vec<f32>,
    pub pred_node: Vec<u32>,
    pub pred_edge: Vec<u32>,
    heap: BinaryHeap<Reverse<(u32, u32)>>,
    /// Nodes reached by the previous run, reset lazily
    touched: Vec<u32>,
}

impl Engine {
    /// Allocates every buffer for a graph of this size
    pub fn reserve(&mut self, nodes: usize, arcs: usize, sources: usize) {
        self.offsets = vec![0; nodes + 1];
        self.heads = vec![0; arcs];
        self.costs = vec![0.0; arcs];
        self.arc_edge = vec![0; arcs];
        self.src_nodes = vec![0; sources];
        self.src_costs = vec![0.0; sources];
        self.dist = vec![f32::INFINITY; nodes];
        self.pred_node = vec![NONE; nodes];
        self.pred_edge = vec![NONE; nodes];
        self.heap = BinaryHeap::with_capacity(arcs + sources);
        self.touched = Vec::with_capacity(nodes);
    }

    /// Clears what the previous run reached (cheaper than refilling every node)
    fn reset(&mut self) {
        for &n in &self.touched {
            self.dist[n as usize] = f32::INFINITY;
            self.pred_node[n as usize] = NONE;
            self.pred_edge[n as usize] = NONE;
        }
        self.touched.clear();
        self.heap.clear();
    }

    /// Lowers the time of a node if `time` is better and within the bound
    fn relax(&mut self, node: usize, time: f32, max_cost: f32, pred: Option<(u32, u32)>) {
        if time >= self.dist[node] || time > max_cost {
            return;
        }
        if self.dist[node].is_infinite() {
            self.touched.push(node as u32);
        }
        self.dist[node] = time;
        if let Some((pred_node, pred_edge)) = pred {
            self.pred_node[node] = pred_node;
            self.pred_edge[node] = pred_edge;
        }
        // Non-negative floats order like their bit patterns
        self.heap.push(Reverse((time.to_bits(), node as u32)));
    }

    /// Shortest times from the first `sources` sources (each with its starting cost), up to `max_cost` seconds.
    /// Returns the number of settled nodes.
    pub fn run(&mut self, sources: usize, max_cost: f32) -> u32 {
        self.reset();
        for i in 0..sources {
            self.relax(
                self.src_nodes[i] as usize,
                self.src_costs[i],
                max_cost,
                None,
            );
        }
        let mut settled = 0;
        while let Some(Reverse((bits, n))) = self.heap.pop() {
            let d = f32::from_bits(bits);
            let n = n as usize;
            if d > self.dist[n] {
                continue;
            }
            settled += 1;
            for arc in self.offsets[n] as usize..self.offsets[n + 1] as usize {
                let head = self.heads[arc] as usize;
                self.relax(
                    head,
                    d + self.costs[arc],
                    max_cost,
                    Some((n as u32, self.arc_edge[arc])),
                );
            }
        }
        settled
    }
}

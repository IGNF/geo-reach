/** What the routing engine shares with the map about node times */

/** Width of the rows the engine lays the node times out in: node n is at (n % TIMES_WIDTH, n / TIMES_WIDTH), so the
 * times read in node order */
export const TIMES_WIDTH = 2048;
/**
 * The time of an unreached node: beyond any scale, still finite. Some drivers (Chrome on Linux, ANGLE over OpenGL)
 * read Infinity back from a float texture as 0, which would color the whole network as reached.
 */
export const UNREACHED = 1e30;

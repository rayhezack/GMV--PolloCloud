/** Keep each event at its date; use another row when its tile would overlap. */
export function layoutEventTiles(times: number[], start: number, end: number, width: number) {
  const size = 24, pitch = 32;
  const laneEnds: number[] = [];
  const positions: {left: number; top: number}[] = [];
  times.map((time, index) => ({time, index})).sort((a,b) => a.time-b.time).forEach(({time, index}) => {
    const left = Math.round((end > start ? (time-start)/(end-start)*width : width/2)-size/2);
    let lane = laneEnds.findIndex(right => left >= right+8);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = left+size;
    positions[index] = {left, top: lane*pitch};
  });
  const height = size+Math.max(0,laneEnds.length-1)*pitch;
  return {height, positions: positions.map(p => ({left: p.left, top: height-size-p.top}))};
}

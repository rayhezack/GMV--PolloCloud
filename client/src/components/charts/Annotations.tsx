/** Draw-only layers shared by SVG charts. Product actions belong to the calendar. */
export function WeekendBand({x,width,height,y=0}:{x:number;width:number;height:number;y?:number}) {return <rect className="chart-weekend" x={x} width={width} height={height} y={y}/>;}
export function AnomalyRing({x,y}:{x:number;y:number}) {return <circle className="chart-anomaly" cx={x} cy={y} r={4}/>;}

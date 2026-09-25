// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useMemo,useRef,useState} from 'react';
import type {SystemModule,ModuleConnection} from '../lib/systemMap';

export function SystemDiagram({modules,layers,connections,selected,onSelect,onConnection}:{modules:SystemModule[];layers:string[];connections:ModuleConnection[];selected:string|null;onSelect:(id:string)=>void;onConnection:(edge:ModuleConnection)=>void}){
  const svg=useRef<SVGSVGElement>(null),drag=useRef<{x:number;y:number;left:number;top:number;scale:number}|null>(null);
  const [zoom,setZoom]=useState(1),[pan,setPan]=useState({x:0,y:0});
  const key=modules.map(n=>n.id).join(',');
  const geometry=useMemo(()=>{const active=layers.filter(layer=>modules.some(n=>n.layer===layer)),positions=new Map<string,{x:number;y:number}>();let rows=0;
    active.forEach((layer,col)=>{const group=modules.filter(n=>n.layer===layer);rows=Math.max(rows,group.length);group.forEach((n,i)=>positions.set(n.id,{x:24+col*240,y:60+i*90}));});
    return {active,positions,width:Math.max(300,active.length*240+24),height:Math.max(300,rows*90+80)};
  },[key,layers]);
  useEffect(()=>{setZoom(1);setPan({x:0,y:0});},[key]);
  const fit=()=>{setZoom(1);setPan({x:0,y:0});};
  const width=geometry.width/zoom,height=geometry.height/zoom,left=(geometry.width-width)/2+pan.x,top=(geometry.height-height)/2+pan.y;
  const near=new Set([selected]);connections.forEach(e=>{if(e.from===selected)near.add(e.to);if(e.to===selected)near.add(e.from);});
  return <div className="sm-diagram"><div className="sm-zoom"><span>{modules.length} modules</span><button onClick={()=>setZoom(v=>Math.max(1,v/1.3))} aria-label="Zoom map out">−</button><output>{Math.round(zoom*100)}%</output><button onClick={()=>setZoom(v=>Math.min(5,v*1.3))} aria-label="Zoom map in">+</button><button onClick={fit}>Fit map</button><button disabled={!selected} onClick={()=>{const p=geometry.positions.get(selected!);if(p){setZoom(3);setPan({x:p.x+100-geometry.width/2,y:p.y+30-geometry.height/2});}}}>Focus module</button></div>
    <svg ref={svg} viewBox={`${left} ${top} ${width} ${height}`} role="group" aria-label="System module dependencies" tabIndex={0}
      onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='Home'){e.preventDefault();fit();}else if(['+','=','-'].includes(e.key)){e.preventDefault();setZoom(v=>Math.max(1,Math.min(5,v*(e.key==='-'?1/1.3:1.3))));}}}
      onPointerDown={e=>{if((e.target as Element).closest('[role=button]'))return;drag.current={x:e.clientX,y:e.clientY,left:pan.x,top:pan.y,scale:e.currentTarget.getScreenCTM()?.a||1};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(drag.current)setPan({x:Math.max(-geometry.width/2,Math.min(geometry.width/2,drag.current.left-(e.clientX-drag.current.x)/drag.current.scale)),y:Math.max(-geometry.height/2,Math.min(geometry.height/2,drag.current.top-(e.clientY-drag.current.y)/drag.current.scale))});}}
      onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}>
      <title>Module architecture. Select nodes or connections. These are dependencies, not wallet transfers.</title>
      {geometry.active.map((layer,i)=><text className="sm-layer" key={layer} x={24+i*240} y={30}>{layer}</text>)}
      {connections.map((edge,i)=>{const a=geometry.positions.get(edge.from),b=geometry.positions.get(edge.to);if(!a||!b)return null;const path=`M${a.x+202},${a.y+30} C${a.x+242},${a.y+30} ${b.x-40},${b.y+30} ${b.x},${b.y+30}`;return <g key={i} className="sm-edge" role="button" tabIndex={0} aria-label={edge.contract} onClick={()=>onConnection(edge)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onConnection(edge);}}}><path className="sm-edge-hit" d={path}/><path className="sm-edge-line" d={path}/><title>{edge.contract}</title></g>;})}
      {modules.map(node=>{const p=geometry.positions.get(node.id)!;return <g key={node.id} data-module={node.id} className={`sm-node ${selected===node.id?'is-selected':''} ${selected&&!near.has(node.id)?'is-dimmed':''}`} role="button" tabIndex={0} aria-label={`${node.title}, ${node.status}, ${node.access}`} aria-pressed={selected===node.id} onClick={()=>onSelect(node.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(node.id);}}} onFocus={()=>{if(zoom>1)setPan({x:p.x+101-geometry.width/2,y:p.y+31-geometry.height/2});}}><title>{node.title}</title><rect x={p.x} y={p.y} width={202} height={64} rx={8}/><text x={p.x+12} y={p.y+25}>{node.title}</text><text className="sm-node-sub" x={p.x+12} y={p.y+47}>{node.status} / {node.access}</text></g>;})}
      {!modules.length&&<text className="sm-layer" x={24} y={120}>No modules match these filters.</text>}
    </svg><p className="sm-note">Drag the background to pan · + / − to zoom · Home to fit · Select a module or connection</p>
  </div>;
}

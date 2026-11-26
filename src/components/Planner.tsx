'use client'
import { useEffect, useRef, useState } from 'react'
import { CATALOG, FLOOR_COLORS, WALL_COLORS, canPlace, edgeBlocked, edgeLine, edgeRect, eIdx, fillCells, fp, inB, inE, itemOf, lineCells, nearestEdge, newPlan, objAt, rectCells } from '@/lib/plan'
import type { EdgeRef, Item, Kind, Plan, Pt, Rot } from '@/lib/plan'

type Tool = 'floor' | 'wall' | 'object' | 'eraser' | 'hand' | 'nobuild'
type Mode = 'single' | 'brush' | 'line' | 'rect' | 'fill'
type WKind = Kind | 'clear'
type Shape = { cells?: Pt[]; edges?: EdgeRef[] }
const CS = 40, KEY = 'base-planner-v3', GW = 21, GH = 18 // taille de grille fixe (largeur x hauteur)
const MODES: Record<Tool, Mode[]> = { floor: ['single', 'brush', 'line', 'rect', 'fill'], wall: ['single', 'line', 'rect'], object: ['single', 'brush', 'line', 'rect'], eraser: ['single', 'brush', 'rect'], hand: [], nobuild: ['single', 'brush', 'line', 'rect'] }
const MODE_NAME: Record<Mode, string> = { single: 'Case', brush: 'Pinceau', line: 'Ligne', rect: 'Rectangle', fill: 'Remplir' }
const TOOL_NAME: Record<Tool, string> = { floor: 'Sol', wall: 'Mur', object: 'Objet', nobuild: 'Zone interdite', eraser: 'Gomme', hand: 'Main' }
const WKINDS: [WKind, string][] = [['wall', 'Mur'], ['door', 'Porte'], ['window', 'Fenêtre'], ['clear', 'Effacer mur']]
const BAND = 2 // largeur (en cases) de la zone neutre entre la zone constructible et le vert
const BAND_TINT = 'rgba(0,0,0,0)' // teinte de cette zone : transparent = herbe naturelle (ex. 'rgba(255,255,255,.08)' pour l'éclaircir)
const M = BAND + 3 // marge totale autour de la zone constructible : zone neutre + vert « hors carte »
const hash = (x: number, y: number, s = 0) => { let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(s + 1, 144665); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295 }
function makeTerrain(cw: number, ch: number, img?: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = cw * CS; c.height = ch * CS
  const g = c.getContext('2d')!
  if (img) { g.fillStyle = g.createPattern(img, 'repeat')!; g.fillRect(0, 0, c.width, c.height) }
  else for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const v = hash(x, y), px = x * CS, py = y * CS
    g.fillStyle = `rgb(${52 + v * 20 | 0},${66 + v * 24 | 0},${28 + v * 12 | 0})`; g.fillRect(px, py, CS, CS)
    for (let k = 0; k < 5; k++) {
      const a = hash(x, y, k + 1), b = hash(x, y, k + 9)
      g.fillStyle = a > .82 ? 'rgba(215,232,245,.28)' : 'rgba(28,42,14,.28)'
      g.beginPath(); g.ellipse(px + a * CS, py + b * CS, 3 + a * 8, 2 + b * 5, a * 3, 0, 7); g.fill()
    }
  }
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const inside = x >= M && x < cw - M && y >= M && y < ch - M
    const near = x >= M - BAND && x < cw - M + BAND && y >= M - BAND && y < ch - M + BAND
    g.fillStyle = inside ? 'rgba(255,255,255,.12)' : near ? BAND_TINT : 'rgba(70,205,30,.5)'; g.fillRect(x * CS, y * CS, CS, CS)
  }
  return c
}
const asset = (p: string) => (process.env.NEXT_PUBLIC_BASE_PATH || '') + p

// Carrés rouges (cases interdites) présents au lancement. x et y partent du coin haut-gauche (0).
// w et h sont facultatifs (1 par défaut) : { x: 3, y: 5 } = un seul carré ; { x: 0, y: 12, w: 5, h: 4 } = un bloc de carrés.
// Ils peuvent être retirés dans l'appli (outil « Zone interdite » en mode Retirer, ou Gomme).
const DEFAULT_NOBUILD: { x: number; y: number; w?: number; h?: number }[] = [
  { x: 20, y: 0, w: 2, h: 2 },
  { x: 18, y: 0, w: 2, h: 2 },
]
function withDefaults(p: Plan): Plan {
  const n = structuredClone(p)
  for (const r of DEFAULT_NOBUILD) for (let y = r.y; y < r.y + (r.h ?? 1); y++) for (let x = r.x; x < r.x + (r.w ?? 1); x++) {
    if (!inB(n, x, y)) continue
    const i = y * n.w + x; n.nb[i] = true; n.floor[i] = 0
    const o = objAt(n, x, y); if (o) n.objs = n.objs.filter(q => q !== o)
  }
  for (const e of ['h', 'v'] as const) { const a = e === 'h' ? n.hw : n.vw, cols = e === 'h' ? n.w : n.w + 1; a.forEach((w, i) => { if (w && edgeBlocked(n, { o: e, x: i % cols, y: Math.floor(i / cols) })) a[i] = null }) }
  return n
}
const freshPlan = () => withDefaults(newPlan(GW, GH))
function applyCells(p: Plan, cells: Pt[], tool: Tool, level: number, it: Item, rot: Rot, nbRemove = false): Plan {
  const n = structuredClone(p)
  for (const c of cells) {
    if (!inB(n, c.x, c.y)) continue
    const i = c.y * n.w + c.x
    if (tool === 'floor') { if (!n.nb[i]) n.floor[i] = level }
    else if (tool === 'nobuild') {
      if (nbRemove) { n.nb[i] = false; continue }
      n.nb[i] = true; n.floor[i] = 0; const o = objAt(n, c.x, c.y); if (o) n.objs = n.objs.filter(q => q !== o)
      for (const e of [{ o: 'h', x: c.x, y: c.y }, { o: 'h', x: c.x, y: c.y + 1 }, { o: 'v', x: c.x, y: c.y }, { o: 'v', x: c.x + 1, y: c.y }] as EdgeRef[]) if (edgeBlocked(n, e)) (e.o === 'h' ? n.hw : n.vw)[eIdx(n, e)] = null
    }
    else if (tool === 'eraser') { const o = objAt(n, c.x, c.y); if (o) n.objs = n.objs.filter(q => q !== o); else if (n.floor[i]) n.floor[i] = 0; else n.nb[i] = false }
    else if (canPlace(n, it, c.x, c.y, rot)) n.objs.push({ id: n.next++, t: it.id, x: c.x, y: c.y, r: rot })
  }
  return n
}
function applyEdges(p: Plan, es: EdgeRef[], kind: WKind, level: number): Plan {
  const n = structuredClone(p)
  for (const e of es) if (inE(n, e) && !edgeBlocked(n, e)) (e.o === 'h' ? n.hw : n.vw)[eIdx(n, e)] = kind === 'clear' ? null : { k: kind, l: level }
  return n
}
export default function Planner() {
  const [plan, setPlan] = useState<Plan>(freshPlan)
  const [tool, setTool] = useState<Tool>('wall')
  const [mode, setMode] = useState<Mode>('line')
  const [level, setLevel] = useState(1)
  const [wk, setWk] = useState<WKind>('wall')
  const [itemId, setItemId] = useState(CATALOG[0].id)
  const [rot, setRot] = useState<Rot>(0)
  const [nbRemove, setNbRemove] = useState(false)
  const [pv, setPv] = useState<Shape | null>(null)
  const [tick, setTick] = useState(0)
  const cv = useRef<HTMLCanvasElement>(null)
  const undo = useRef<Plan[]>([]), redo = useRef<Plan[]>([])
  const drag = useRef<{ a: Tgt; path: Pt[] } | null>(null)
  const imgs = useRef(new Map<string, HTMLImageElement>())
  const loaded = useRef(false)
  const view = useRef<HTMLElement>(null)
  const pan = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null)
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 })
  const fit = () => { const v = view.current; if (!v) return; const cw = (GW + 2 * M) * CS, ch = (GH + 2 * M) * CS, z = Math.min(v.clientWidth / cw, v.clientHeight / ch) * .95; setCam({ z, x: (v.clientWidth - cw * z) / 2, y: (v.clientHeight - ch * z) / 2 }) }
  const zoomAt = (px: number, py: number, f: number) => setCam(c => { const z = Math.min(4, Math.max(.2, c.z * f)), k = z / c.z; return { z, x: px - (px - c.x) * k, y: py - (py - c.y) * k } })
  const zoomCenter = (f: number) => { const v = view.current; if (v) zoomAt(v.clientWidth / 2, v.clientHeight / 2, f) }
  const wheel = (e: React.WheelEvent) => { const r = view.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 1 / 1.1) }
  const vDown = (e: React.PointerEvent) => { if (tool === 'hand' || e.button === 1 || e.target !== cv.current) { pan.current = { sx: e.clientX, sy: e.clientY, x: cam.x, y: cam.y }; view.current!.setPointerCapture(e.pointerId) } }
  const vMove = (e: React.PointerEvent) => { const p = pan.current; if (p) setCam(c => ({ ...c, x: p.x + e.clientX - p.sx, y: p.y + e.clientY - p.sy })) }
  const vUp = () => { pan.current = null }
  useEffect(() => { fit() }, [])
  const grass = useRef<HTMLImageElement | null>(null)
  const terrain = useRef<{ k: string; c: HTMLCanvasElement } | null>(null)
  type Tgt = { cell: Pt; vert: Pt; edge: EdgeRef }
  const it = itemOf(itemId)

  useEffect(() => { try { const s = localStorage.getItem(KEY); if (s) { const d = JSON.parse(s); if (d.w === GW && d.h === GH) setPlan({ ...d, nb: d.nb ?? Array(GW * GH).fill(false) }) } } catch {} loaded.current = true }, [])
  useEffect(() => { if (loaded.current) try { localStorage.setItem(KEY, JSON.stringify(plan)) } catch {} }, [plan])

  const commit = (n: Plan) => { undo.current.push(plan); if (undo.current.length > 100) undo.current.shift(); redo.current = []; setPlan(n) }
  const doUndo = () => { const p = undo.current.pop(); if (p) { redo.current.push(plan); setPlan(p) } }
  const doRedo = () => { const p = redo.current.pop(); if (p) { undo.current.push(plan); setPlan(p) } }
  const pickTool = (t: Tool) => { setTool(t); if (!MODES[t].includes(mode)) setMode('single') }

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo() }
      else if (e.key.toLowerCase() === 'r' && it.rotatable) setRot(r => ((r + 90) % 360) as Rot)
    }
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f)
  })

  const target = (e: React.PointerEvent): Tgt => {
    const r = cv.current!.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width * (plan.w + 2 * M) - M, fy = (e.clientY - r.top) / r.height * (plan.h + 2 * M) - M
    return { cell: { x: Math.floor(fx), y: Math.floor(fy) }, vert: { x: Math.round(fx), y: Math.round(fy) }, edge: nearestEdge(fx, fy) }
  }
  const shape = (a: Tgt, b: Tgt): Shape => {
    if (tool === 'wall') return mode === 'single' ? { edges: [a.edge] } : mode === 'line' ? { edges: edgeLine(a.vert, b.vert) } : { edges: edgeRect(a.vert, b.vert) }
    if (mode === 'brush') return { cells: drag.current?.path ?? [] }
    if (mode === 'line') return { cells: lineCells(a.cell, b.cell) }
    if (mode === 'rect') return { cells: rectCells(a.cell, b.cell) }
    if (mode === 'fill') return { cells: fillCells(plan, a.cell, level) }
    return { cells: [a.cell] }
  }
  const down = (e: React.PointerEvent) => { if (e.button !== 0 || tool === 'hand') return; const t = target(e); drag.current = { a: t, path: [t.cell] }; cv.current!.setPointerCapture(e.pointerId); setPv(shape(t, t)) }
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const t = target(e), l = d.path[d.path.length - 1]
    if (mode === 'brush' && (l.x !== t.cell.x || l.y !== t.cell.y)) d.path.push(t.cell)
    setPv(shape(d.a, t))
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const s = shape(d.a, target(e)); drag.current = null; setPv(null)
    let n = plan
    if (s.cells) n = applyCells(n, s.cells, tool, level, it, rot, nbRemove)
    if (s.edges) n = applyEdges(n, s.edges, wk, level)
    commit(n)
  }

  useEffect(() => {
    const c = cv.current; if (!c) return
    const g = c.getContext('2d')!, W = plan.w * CS, H = plan.h * CS
    c.width = W + 2 * M * CS; c.height = H + 2 * M * CS
    if (!grass.current) { const im = new Image(); im.onload = () => setTick(t => t + 1); im.src = asset('/assets/grass.png'); grass.current = im }
    const ok = grass.current.complete && grass.current.naturalWidth > 0
    const k = `${plan.w}x${plan.h}${ok ? 'i' : 'p'}`
    if (terrain.current?.k !== k) terrain.current = { k, c: makeTerrain(plan.w + 2 * M, plan.h + 2 * M, ok ? grass.current : undefined) }
    g.drawImage(terrain.current.c, 0, 0); g.translate(M * CS, M * CS)
    for (let y = 0; y < plan.h; y++) for (let x = 0; x < plan.w; x++) { const l = plan.floor[y * plan.w + x]; if (l) { g.fillStyle = FLOOR_COLORS[l]; g.fillRect(x * CS, y * CS, CS, CS) } }
    g.strokeStyle = 'rgba(255,255,255,.32)'; g.lineWidth = 1; g.beginPath()
    for (let x = 0; x <= plan.w; x++) { g.moveTo(x * CS + .5, 0); g.lineTo(x * CS + .5, H) }
    for (let y = 0; y <= plan.h; y++) { g.moveTo(0, y * CS + .5); g.lineTo(W, y * CS + .5) }
    g.stroke()
    g.fillStyle = 'rgba(255,255,255,.85)'
    for (let y = 0; y <= plan.h; y++) for (let x = 0; x <= plan.w; x++) { g.fillRect(x * CS - 3, y * CS - .5, 7, 1.5); g.fillRect(x * CS - .5, y * CS - 3, 1.5, 7) }
    // Carrés rouges : cases interdites (dessinés par-dessus la grille)
    for (let y = 0; y < plan.h; y++) for (let x = 0; x < plan.w; x++) if (plan.nb[y * plan.w + x]) {
      g.fillStyle = '#d93a3a'; g.fillRect(x * CS + 2, y * CS + 2, CS - 4, CS - 4)
      g.strokeStyle = '#ff8a8a'; g.lineWidth = 2; g.strokeRect(x * CS + 3, y * CS + 3, CS - 6, CS - 6)
    }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${CS * .55}px sans-serif`
    for (const o of plan.objs) {
      const i = itemOf(o.t), f = fp(i, o.r), cx = (o.x + f.w / 2) * CS, cy = (o.y + f.h / 2) * CS
      let im = i.image ? imgs.current.get(i.image) : undefined
      if (i.image && !im) { im = new Image(); im.onload = () => setTick(t => t + 1); im.src = asset(i.image); imgs.current.set(i.image, im) }
      g.save(); g.translate(cx, cy)
      if (im?.complete && im.naturalWidth) { g.rotate(o.r * Math.PI / 180); g.drawImage(im, -i.w * CS / 2, -i.h * CS / 2, i.w * CS, i.h * CS) }
      else { g.fillStyle = i.color; g.fillRect(-f.w * CS / 2 + 2, -f.h * CS / 2 + 2, f.w * CS - 4, f.h * CS - 4); g.fillStyle = '#fff'; g.fillText(i.icon, 0, 1) }
      g.restore()
    }
    const seg = (e: EdgeRef): [number, number, number, number] => e.o === 'h' ? [e.x * CS, e.y * CS, (e.x + 1) * CS, e.y * CS] : [e.x * CS, e.y * CS, e.x * CS, (e.y + 1) * CS]
    const stroke = (e: EdgeRef, col: string, w: number, cap: CanvasLineCap) => { const [a, b, c2, d] = seg(e); g.strokeStyle = col; g.lineWidth = w; g.lineCap = cap; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke() }
    const walls = (arr: (typeof plan.hw), o: 'h' | 'v', cols: number) => arr.forEach((w, i) => {
      if (!w) return
      const e: EdgeRef = { o, x: i % cols, y: Math.floor(i / cols) }
      stroke(e, WALL_COLORS[w.l], 8, 'square')
      if (w.k === 'door') stroke(e, '#e9d9a8', 4, 'butt'); else if (w.k === 'window') stroke(e, '#8fd3ee', 4, 'butt')
    })
    walls(plan.hw, 'h', plan.w); walls(plan.vw, 'v', plan.w + 1)
    if (pv?.cells) { g.fillStyle = tool === 'nobuild' ? (nbRemove ? 'rgba(255,255,255,.45)' : 'rgba(217,58,58,.55)') : 'rgba(60,195,214,.35)'; for (const p of pv.cells) if (inB(plan, p.x, p.y)) g.fillRect(p.x * CS, p.y * CS, CS, CS) }
    if (pv?.edges) for (const e of pv.edges) if (inE(plan, e) && !edgeBlocked(plan, e)) stroke(e, 'rgba(60,195,214,.8)', 8, 'square')
  }, [plan, pv, tick])

  const counts = plan.objs.reduce<Record<string, number>>((a, o) => (a[o.t] = (a[o.t] || 0) + 1, a), {})
  const lv = (
    <div className="row">{[1, 2, 3, 4, 5].map(l => <button key={l} aria-pressed={level === l} onClick={() => setLevel(l)}><span className="sw" style={{ background: tool === 'wall' ? WALL_COLORS[l] : FLOOR_COLORS[l] }} />{l}</button>)}</div>
  )
  return (
    <div className="app">
      <aside className="side">
        <h1>Planificateur de base</h1>
        <h2>Outil</h2>
        <div className="row">{(Object.keys(TOOL_NAME) as Tool[]).map(t => <button key={t} aria-pressed={tool === t} onClick={() => pickTool(t)}>{TOOL_NAME[t]}</button>)}</div>
        <h2>Mode</h2>
        <div className="row">{MODES[tool].map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE_NAME[m]}</button>)}</div>
        {(tool === 'floor' || tool === 'wall') && <><h2>Niveau de matériau</h2>{lv}</>}
        {tool === 'wall' && <><h2>Type de mur</h2><div className="row">{WKINDS.map(([k, n]) => <button key={k} aria-pressed={wk === k} onClick={() => setWk(k)}>{n}</button>)}</div></>}
        {tool === 'object' && <>
          <h2>Objet</h2>
          <div className="row">{CATALOG.map(i => <button key={i.id} aria-pressed={itemId === i.id} onClick={() => setItemId(i.id)}>{i.icon} {i.name}</button>)}</div>
          <h2>Rotation : {rot}°</h2>
          <button disabled={!it.rotatable} onClick={() => setRot(r => ((r + 90) % 360) as Rot)}>Pivoter (R)</button>
          <p className="mu">Un objet se pose uniquement sur un sol{it.max ? `, maximum ${it.max}` : ''}.</p>
        </>}
        {tool === 'nobuild' && <>
          <div className="row">
            <button aria-pressed={!nbRemove} onClick={() => setNbRemove(false)}>Poser un carré rouge</button>
            <button aria-pressed={nbRemove} onClick={() => setNbRemove(true)}>Retirer (repasser en blanc)</button>
          </div>
          <p className="mu">Un carré rouge bloque les sols et les objets. Les murs ne sont possibles que sur ses côtés collés à une zone blanche. La gomme peut aussi le retirer.</p>
          <div className="row">
            <button onClick={() => commit(withDefaults(plan))}>Remettre les zones de départ</button>
            <button onClick={() => commit({ ...plan, nb: Array(plan.w * plan.h).fill(false) })}>Retirer toutes les zones</button>
          </div>
        </>}
      </aside>
      <section className="stage" ref={view} style={{ cursor: tool === 'hand' ? 'grab' : undefined }} onPointerDown={vDown} onPointerMove={vMove} onPointerUp={vUp} onPointerCancel={vUp} onWheel={wheel}>
        <canvas ref={cv} style={{ transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.z})` }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setPv(null) }} />
        <div className="float" onPointerDown={e => e.stopPropagation()}>
          <button disabled={!undo.current.length} onClick={doUndo}>Annuler</button>
          <button disabled={!redo.current.length} onClick={doRedo}>Rétablir</button>
          <button onClick={() => commit(freshPlan())}>Tout effacer</button>
          <button onClick={() => zoomCenter(1 / 1.2)}>−</button><span className="mu">{Math.round(cam.z * 100)} %</span><button onClick={() => zoomCenter(1.2)}>+</button>
          <button onClick={fit}>Réinitialiser la caméra</button>
        </div>
        <p className="foot mu">{CATALOG.filter(i => counts[i.id]).map(i => `${i.name} : ${counts[i.id]}`).join(' · ') || 'Aucun objet posé.'}</p>
      </section>
    </div>
  )
}

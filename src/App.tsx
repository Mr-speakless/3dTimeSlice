import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { createScene, DEFAULT_TIME_SCALE } from '@/scene'
import type { SliceInfo } from '@/scene'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Kbd } from '@/components/ui/kbd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type SceneApi = ReturnType<typeof createScene>

// Each preset names the three axes the slice still spans.
const PRESETS = [
  { label: 'Now', hint: 'XYZ', ax: 0, ay: 0, az: 0 },
  { label: 'Side', hint: 'YZT', ax: 90, ay: 0, az: 0 },
  { label: 'Top', hint: 'XZT', ax: 0, ay: 90, az: 0 },
  { label: 'Front', hint: 'XYT', ax: 0, ay: 0, az: 90 },
  { label: 'Diagonal', hint: '', ax: 35, ay: 25, az: 0 },
  { label: 'Slight', hint: '', ax: 15, ay: 0, az: 0 },
]
const MODES = [
  { value: 'loop', label: 'Loop' },
  { value: 'pingpong', label: 'Ping-pong' },
]

const first = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number))

/** Number input that lets you type freely and commits (clamped) on every valid keystroke. */
function NumField({ value, min, max, step, decimals, suffix, onCommit }: {
  value: number; min: number; max: number; step: number; decimals: number; suffix?: string
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-1 text-sm text-muted-foreground">
      <Input
        type="number"
        className="h-9 w-[5.25rem] px-2.5 text-right text-sm font-medium tabular-nums text-foreground"
        min={min} max={max} step={step}
        value={draft ?? value.toFixed(decimals)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value)
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onCommit(Math.min(max, Math.max(min, v)))
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
      />
      {suffix && <span className="w-2.5">{suffix}</span>}
    </div>
  )
}

function Field({ label, htmlFor, right, children }: { label: string; htmlFor?: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex min-h-9 items-center justify-between">
        <Label htmlFor={htmlFor} className="text-sm font-medium">{label}</Label>
        {right}
      </div>
      {children}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="text-base font-semibold tracking-tight">{title}</CardTitle>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  )
}

function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  )
}

const valueCls = 'text-sm font-medium tabular-nums'

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<SceneApi | null>(null)

  const [slice, setSlice] = useState<SliceInfo>({ ax: 0, ay: 0, az: 0, pos: 0, normal: [0, 0, 0, 1], tilt: 0, time: 0 })
  const [playing, setPlaying] = useState(false)
  const [looking, setLooking] = useState(false)
  const [mode, setMode] = useState('loop')
  const [speed, setSpeed] = useState(1)
  const [timeScale, setTimeScale] = useState(DEFAULT_TIME_SCALE)
  const [contours, setContours] = useState(false)
  const [showMap, setShowMap] = useState(true)
  const [follow, setFollow] = useState(false)
  const [fade, setFade] = useState(false)

  useEffect(() => {
    const api = createScene(canvasRef.current!, stageRef.current!, mapRef.current!, {
      onSlice: setSlice, onPlaying: setPlaying, onLooking: setLooking,
    })
    sceneRef.current = api
    return () => api.dispose()
  }, [])

  const scene = () => sceneRef.current!

  // keyboard: Space = play/pause (walking keys are handled by the scene itself)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (e.code === 'Space' && t.tagName !== 'BUTTON' && t.getAttribute?.('role') !== 'combobox') {
        e.preventDefault()
        scene().togglePlaying()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const n = slice.normal

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground md:flex-row">
      {/* ───── stage ───── */}
      <div ref={stageRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        <canvas ref={canvasRef} tabIndex={-1} className="block h-full w-full cursor-crosshair outline-none" />

        {!looking && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-xl border bg-card/85 px-4 py-2.5 text-sm text-muted-foreground shadow-lg backdrop-blur-sm">
              <span>Click to look around</span>
              <span className="flex items-center gap-1"><Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd> or arrows to walk</span>
              <span className="flex items-center gap-1"><Kbd>Q</Kbd><Kbd>E</Kbd> down / up</span>
              <span className="flex items-center gap-1"><Kbd>Shift</Kbd> faster</span>
              <span className="flex items-center gap-1"><Kbd>Esc</Kbd> release</span>
            </div>
          </div>
        )}

        <div className={`absolute bottom-4 left-4 w-64 overflow-hidden rounded-xl border bg-card/85 shadow-lg backdrop-blur-sm ${showMap ? '' : 'hidden'}`}>
          <canvas ref={mapRef} className="block h-56 w-full cursor-grab active:cursor-grabbing" />
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Spacetime map · floor plan × time, height dropped. Green is the slice you are standing in.
          </p>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
          <Button size="lg" className="pointer-events-auto min-w-32 shadow-lg" onClick={() => scene().togglePlaying()} title="Space">
            {playing ? <Pause /> : <Play />} {playing ? 'Pause' : 'Play'}
          </Button>
        </div>
      </div>

      {/* ───── panel (cards) ───── */}
      <aside className="flex h-[46dvh] w-full shrink-0 flex-col gap-3 overflow-y-auto p-3 *:shrink-0 md:h-full md:w-[24rem] md:pl-0">
        <Card className="gap-4">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-xl font-semibold tracking-tight">Time Slice 4D</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => scene().reset()}>
                <RotateCcw /> Reset
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5">
              <Readout label="Your moment">{slice.time.toFixed(2)} s</Readout>
              <Readout label="Tilt away from time">{slice.tilt.toFixed(1)}°</Readout>
              <Readout label="Normal (x y z t)">{n.map((v) => (Object.is(Number(v.toFixed(2)), -0) ? 0 : v).toFixed(2)).join('  ')}</Readout>
            </dl>
          </CardContent>
        </Card>

        <Section title="Slice" hint="Three angles turn the slice about where and when you are standing. Position moves it along its own normal — the one direction you cannot walk in.">
          <Field label="Tilt towards X" htmlFor="ax" right={
            <NumField value={slice.ax} min={-180} max={180} step={0.1} decimals={1} suffix="°" onCommit={(v) => scene().setSlice({ ax: v })} />}>
            <Slider id="ax" min={-180} max={180} step={0.5} value={[slice.ax]} onValueChange={(v) => scene().setSlice({ ax: first(v) })} />
          </Field>
          <Field label="Tilt towards Y" htmlFor="ay" right={
            <NumField value={slice.ay} min={-90} max={90} step={0.1} decimals={1} suffix="°" onCommit={(v) => scene().setSlice({ ay: v })} />}>
            <Slider id="ay" min={-90} max={90} step={0.5} value={[slice.ay]} onValueChange={(v) => scene().setSlice({ ay: first(v) })} />
          </Field>
          <Field label="Tilt towards Z" htmlFor="az" right={
            <NumField value={slice.az} min={-90} max={90} step={0.1} decimals={1} suffix="°" onCommit={(v) => scene().setSlice({ az: v })} />}>
            <Slider id="az" min={-90} max={90} step={0.5} value={[slice.az]} onValueChange={(v) => scene().setSlice({ az: first(v) })} />
          </Field>
          <Field label="Position" htmlFor="pos" right={
            <NumField value={slice.pos} min={-1} max={1} step={0.001} decimals={3} onCommit={(v) => scene().setSlice({ pos: v })} />}>
            <Slider id="pos" min={-1} max={1} step={0.001} value={[slice.pos]} onValueChange={(v) => scene().setSlice({ pos: first(v) })} />
          </Field>
        </Section>

        <Section title="Camera" hint={follow
          ? 'You ride the slice: as it moves along its normal it carries you through the room.'
          : 'You keep your place in the room and your own moment runs at normal speed.'}>
          <Field label="Follow the slice" htmlFor="follow" right={
            <Switch id="follow" checked={follow} onCheckedChange={(on) => { setFollow(on); scene().setFollow(on) }} />} />
        </Section>

        <Section title="Presets">
          <div className="grid grid-cols-2 gap-2.5">
            {PRESETS.map((p) => (
              <Button key={p.label} variant="outline" onClick={() => scene().setSlice({ ax: p.ax, ay: p.ay, az: p.az })}>
                {p.label}{p.hint && <span className="text-muted-foreground">{p.hint}</span>}
              </Button>
            ))}
          </div>
        </Section>

        <Section title="Playback" hint={follow ? 'Playing moves the slice along its own normal at a steady speed.' : 'Playing moves the slice along its own normal, just fast enough for your moment to run at this speed.'}>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" onClick={() => scene().togglePlaying()}>
              {playing ? <Pause /> : <Play />} {playing ? 'Pause' : 'Play'}
            </Button>
            <Select items={MODES} value={mode} onValueChange={(v) => { setMode(v as string); scene().setMode(v as string) }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Field label="Speed" right={<span className={valueCls}>{speed.toFixed(2)}×</span>}>
            <Slider min={0.1} max={3} step={0.05} value={[speed]} onValueChange={(v) => { setSpeed(first(v)); scene().setSpeed(first(v)) }} />
          </Field>
        </Section>

        <Section title="Display">
          <Field label="Time scale" right={<span className={valueCls}>1 s = {timeScale.toFixed(2)} m</span>}>
            <Slider min={0.5} max={12} step={0.1} value={[timeScale]} onValueChange={(v) => { setTimeScale(first(v)); scene().setTimeScale(first(v)) }} />
          </Field>
          <Field label="Time contours" htmlFor="contours" right={
            <Switch id="contours" checked={contours} onCheckedChange={(on) => { setContours(on); scene().setContours(on) }} />} />
          <Field label="Fade objects past 85°" htmlFor="fade" right={
            <Switch id="fade" checked={fade} onCheckedChange={(on) => { setFade(on); scene().setFade(on) }} />} />
          <Field label="Spacetime map" htmlFor="map" right={
            <Switch id="map" checked={showMap} onCheckedChange={(on) => { setShowMap(on); scene().setMapVisible(on) }} />} />
        </Section>
      </aside>
    </div>
  )
}

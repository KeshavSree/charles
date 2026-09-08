'use client'
import { useCallback, useEffect, useState } from 'react'
import { ScanProgress, cancelScan, getScanProgress } from '@/lib/api'

/**
 * Live progress for a scan, read from the server.
 *
 * Shared by /scanner and /jobs because both start the same sweep and must agree about
 * it. Nothing here is inferred from what a tab did: the run lives on the server, so a
 * reload, a second tab, or a run started by the scheduler all show the same thing.
 *
 * This replaced a button that read "Scanning…" for forty minutes and then flipped to
 * "Failed" when the dev proxy timed out -- while the sweep carried on regardless.
 */

// Elapsed/remaining are rendered as m:ss rather than a raw second count because a
// sweep runs for tens of minutes and "1847s" is not a number anyone reads.
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const STATUS_TEXT: Record<string, string> = {
  completed: 'Scan complete',
  failed: 'Scan failed',
  cancelled: 'Scan stopped',
}

export default function ScanProgressPanel({
  progress, onCancelled, stale = false,
}: {
  progress: ScanProgress
  onCancelled?: () => void
  /** Several polls in a row failed: we no longer know what the server is doing. */
  stale?: boolean
}) {
  const [stopping, setStopping] = useState(false)
  const cur = progress.current
  const live = progress.active && !stale
  const pct = cur?.fraction ?? null

  // Extrapolated from the rate observed so far, and only once enough of the stage is
  // done for it to mean anything -- an ETA off the first 1% of 28,746 boards is noise
  // dressed as information.
  const eta =
    live && cur && pct !== null && pct > 0.02 && cur.elapsed
      ? (cur.elapsed / pct) * (1 - pct)
      : null

  const accent =
    stale || progress.status === 'failed' ? '#f87171'
      : progress.status === 'cancelled' ? 'var(--text-muted)'
        : 'var(--gold)'

  async function stop() {
    setStopping(true)
    try {
      await cancelScan()
      onCancelled?.()
    } catch { /* the poll will show whether it actually stopped */ } finally {
      setStopping(false)
    }
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      padding: '10px 12px', background: 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 12, color: stale ? '#f87171' : undefined }}>
          {stale ? 'Lost contact with the server'
            : live ? (cur ? cur.label : 'Starting…')
              : STATUS_TEXT[progress.status] ?? 'Idle'}
        </strong>
        {live && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            stage {(progress.stage_index ?? 0) + 1} of {progress.stage_count ?? 1}
          </span>
        )}
        {!live && (progress.added ?? 0) > 0 && (
          <span style={{ fontSize: 11, color: 'var(--gold)' }}>
            +{(progress.added ?? 0).toLocaleString()} added
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {clock(progress.elapsed ?? 0)}{eta !== null && ` · ~${clock(eta)} left`}
        </span>
        {live && (
          <button
            onClick={stop}
            disabled={stopping}
            title="Stop the running scan"
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-muted)', borderRadius: 4, fontSize: 10,
              padding: '1px 7px', cursor: 'pointer',
            }}
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>

      <div style={{
        height: 6, borderRadius: 3, background: 'var(--border)',
        overflow: 'hidden', position: 'relative',
      }}>
        {live && pct === null ? (
          // Indeterminate: a source that declares no total would otherwise sit at 0%
          // and read as stuck.
          <div style={{
            position: 'absolute', inset: 0, width: '35%',
            background: accent, borderRadius: 3,
            animation: 'charles-scan-slide 1.1s ease-in-out infinite',
          }} />
        ) : (
          <div style={{
            height: '100%', width: `${((live ? pct ?? 0 : 1) * 100).toFixed(1)}%`,
            background: accent, borderRadius: 3,
            transition: 'width 240ms linear',
          }} />
        )}
      </div>

      <div style={{
        display: 'flex', gap: 14, marginTop: 6, fontSize: 11,
        color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
      }}>
        {live && cur?.total ? (
          <span>{cur.done.toLocaleString()} / {cur.total.toLocaleString()} boards</span>
        ) : live && cur ? (
          <span>{cur.done.toLocaleString()} done</span>
        ) : null}
        {live && cur && cur.found > 0 && <span>{cur.found.toLocaleString()} found</span>}
        {(live ? cur?.kept : progress.kept) !== undefined && (
          <span style={{ color: accent }}>
            {(live ? cur?.kept ?? 0 : progress.kept ?? 0).toLocaleString()} kept
          </span>
        )}
        {progress.error && <span style={{ color: '#f87171' }}>{progress.error}</span>}
      </div>

      {progress.stages.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          {progress.stages.map((st) => (
            <span
              key={st.id}
              title={`${st.label} — ${st.status}${st.elapsed ? ` (${clock(st.elapsed)})` : ''}`}
              style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 3,
                border: '1px solid var(--border)',
                borderColor: st.status === 'running' ? 'var(--gold)'
                  : st.status === 'failed' ? '#f87171' : 'var(--border)',
                color: st.status === 'done' ? 'var(--text)'
                  : st.status === 'running' ? 'var(--gold)'
                    : st.status === 'failed' ? '#f87171' : 'var(--text-muted)',
                opacity: st.status === 'pending' ? 0.55 : 1,
              }}
            >
              {st.label}
            </span>
          ))}
        </div>
      )}

      <style>{`@keyframes charles-scan-slide {
        0% { left: -35%; } 100% { left: 100%; }
      }`}</style>
    </div>
  )
}

/**
 * The server's scan state, polled continuously.
 *
 * Deliberately unconditional. The previous version only polled while *this tab* held
 * the request open, which meant a reload showed nothing, a second tab showed nothing,
 * and a proxy timeout made the tab claim the scan had failed while it was still very
 * much running. Nothing here is inferred from what this tab did -- it is a read of
 * what the server is actually doing, so every client agrees and a refresh is free.
 *
 * Polls faster while a run is live, and slowly otherwise so an idle page is cheap.
 */
export function useScanProgress(): {
  progress: ScanProgress | null
  active: boolean
  stale: boolean
  refresh: () => void
} {
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [misses, setMisses] = useState(0)

  const read = useCallback(async () => {
    try {
      setProgress(await getScanProgress())
      setMisses(0)
    } catch {
      // One dropped poll is noise. Several in a row means we no longer know what the
      // server is doing, and continuing to render the last known state would be the
      // same lie this whole change removes -- so say so instead.
      setMisses((n) => n + 1)
    }
  }, [])

  const stale = misses >= 3
  const active = !stale && (progress?.active ?? false)

  useEffect(() => {
    read()
    const id = setInterval(read, active ? 1000 : 5000)
    return () => clearInterval(id)
  }, [read, active])

  // Browsers throttle timers in background tabs to about once a minute, so a tab
  // returning to the foreground can be showing minute-old state. Read immediately on
  // becoming visible, otherwise switching tabs is its own little desync.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [read])

  return { progress, active, stale, refresh: read }
}

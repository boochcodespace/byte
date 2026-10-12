import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/apiFetch'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { getTypeMeta } from '../artifact-renderers/registry'
import LoadingState from './LoadingState'
import ErrorState from './ErrorState'

// ArtifactPicker
//
// Lists the artifacts already in the project, across ALL of its sources,
// of one type, so a lesson slot can reuse one. Picking returns a
// reference ({ source, folder }); nothing is copied, so later edits to the
// artifact show everywhere it is used.
//
// Props:
//   projectSlug — the project to list from
//   type        — artifact type to offer (the slot's type)
//   currentRef  — optional { source, artifact } the slot already uses; it is
//                 shown as "In this lesson" and cannot be picked again
//   onPick      — called with { source, folder }
//   onCancel    — closes the picker

function formatDate(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function ArtifactPicker({ projectSlug, type, currentRef, onPick, onCancel }) {
  const [items, setItems] = useState(null)
  const loadAction = useAsyncAction()
  const { label } = getTypeMeta(type)

  const load = useCallback(async () => {
    const data = await loadAction.run(() =>
      api.get(`/api/projects/${projectSlug}/artifacts?type=${encodeURIComponent(type)}`)
    )
    if (Array.isArray(data)) setItems(data)
  }, [loadAction, projectSlug, type])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, type])

  return (
    <div className="artifact-picker">
      <div className="artifact-picker-head">
        <strong>Pick an existing {label}</strong>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {loadAction.loading && !items && <LoadingState subtle message="Finding artifacts..." />}
      {loadAction.error && !items && (
        <ErrorState message={loadAction.error.userMessage} onRetry={load} />
      )}

      {items && items.length === 0 && (
        <p className="artifact-picker-empty">
          No {label} exists in this project yet. Generate a new one for this lesson instead.
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="artifact-picker-list">
          {items.map((item, idx) => {
            const inUse = !!currentRef && currentRef.source === item.source && currentRef.artifact === item.folder
            return (
            <li key={`${item.source}/${item.folder}`} className="picker-item">
              <div className="picker-item-text">
                <div className="picker-item-title">{item.title || `${label} (no objective saved)`}</div>
                <div className="picker-item-meta">
                  From {item.sourceTitle}{' '}<span aria-hidden="true"> · </span>{' '}{formatDate(item.createdAt)}
                  {item.edited ? <>{' '}<span aria-hidden="true"> · </span>{' '}edited</> : ''}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onPick({ source: item.source, folder: item.folder })}
                disabled={inUse}
                autoFocus={idx === 0 && !inUse}
                aria-label={inUse ? undefined : `Use this ${label}: ${item.title || 'no objective saved'}, from ${item.sourceTitle}`}
              >
                {inUse ? 'In this lesson' : 'Use this'}
              </button>
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default ArtifactPicker

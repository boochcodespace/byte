import { Link } from 'react-router-dom'

// SourceCard renders one source in the dashboard grid.
// Clicking it navigates to the source detail page at /source/<slug>.
function SourceCard({ source }) {
  return (
    <Link to={`/source/${source.slug}`} className="source-card">
      <div className="source-card-icon">📄</div>
      <div className="source-card-body">
        <h3>{source.title}</h3>
        {source.artifactCount > 0 && (
          <p className="source-card-meta">
            {source.artifactCount} artifact{source.artifactCount !== 1 ? 's' : ''} generated
          </p>
        )}
        <p className="source-card-preview">{source.preview}</p>
      </div>
    </Link>
  )
}

export default SourceCard

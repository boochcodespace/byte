import { Link } from 'react-router-dom'

// SourceCard renders one source in the project detail grid.
// Clicking it navigates to /projects/<projectSlug>/sources/<sourceSlug>.
function SourceCard({ source, projectSlug }) {
  return (
    <Link to={`/projects/${projectSlug}/sources/${source.slug}`} className="source-card">
      <div className="source-card-icon">📄</div>
      <div className="source-card-body">
        <h2>{source.title}</h2>
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

import { Link } from 'react-router-dom'

// ProjectCard renders one project in the home grid.
// Clicking it navigates to /projects/<slug>.
function ProjectCard({ project }) {
  const sourceLabel = `${project.sourceCount} source${project.sourceCount !== 1 ? 's' : ''}`
  const artifactLabel = project.artifactCount > 0
    ? ` · ${project.artifactCount} artifact${project.artifactCount !== 1 ? 's' : ''}`
    : ''

  return (
    <Link to={`/projects/${project.slug}`} className="project-card">
      <div className="project-card-icon">📁</div>
      <div className="project-card-body">
        <h2>{project.title}</h2>
        {project.description && (
          <p className="project-card-description">{project.description}</p>
        )}
        <p className="project-card-meta">{sourceLabel}{artifactLabel}</p>
      </div>
    </Link>
  )
}

export default ProjectCard

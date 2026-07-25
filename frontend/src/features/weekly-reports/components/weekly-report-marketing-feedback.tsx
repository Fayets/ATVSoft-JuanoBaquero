'use client'

type Props = {
  feedback: string
}

export function WeeklyReportMarketingFeedback({ feedback }: Props) {
  const text = feedback.trim()
  if (!text) return null

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const bullets = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2))
  const body = bullets.length > 0 ? bullets : lines

  return (
    <section className="weekly-report-marketing">
      <div className="weekly-report-marketing__head">
        <span className="weekly-report-marketing__badge">Marketing</span>
        <h3 className="weekly-report-marketing__title">Feedback marketing</h3>
        <p className="weekly-report-marketing__subtitle">
          Conclusiones accionables para contenido, copy y nurturing de la semana.
        </p>
      </div>
      <ul className="weekly-report-marketing__list">
        {body.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  )
}

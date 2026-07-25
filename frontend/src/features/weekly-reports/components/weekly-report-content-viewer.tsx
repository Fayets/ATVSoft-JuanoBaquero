'use client'

import { useMemo } from 'react'
import { formatWeekRange } from '../services/weekly-reports-service'
import { parseWeeklyContent } from '../lib/parse-weekly-content'

type Props = {
  contenido: string
  semanaInicio: string
  semanaFin: string
}

export function WeeklyReportContentViewer({ contenido, semanaInicio, semanaFin }: Props) {
  const blocks = useMemo(() => parseWeeklyContent(contenido), [contenido])

  return (
    <article className="weekly-report-doc">
      <header className="weekly-report-doc__header">
        <h2 className="weekly-report-doc__title">Reporte Semanal de Ventas</h2>
        <p className="weekly-report-doc__period">{formatWeekRange(semanaInicio, semanaFin)}</p>
      </header>

      <div className="weekly-report-doc__body">
        {blocks.map((block, i) => {
          switch (block.type) {
            case 'main-section':
              return (
                <h3 key={i} className="weekly-report-doc__section">
                  {block.title}
                </h3>
              )
            case 'subsection':
              return (
                <h4 key={i} className="weekly-report-doc__subsection">
                  {block.title}
                </h4>
              )
            case 'bullet':
              return (
                <p key={i} className="weekly-report-doc__bullet">
                  <span className="weekly-report-doc__bullet-dot" aria-hidden />
                  {block.text}
                </p>
              )
            case 'numbered':
              return (
                <p key={i} className="weekly-report-doc__numbered">
                  <span className="weekly-report-doc__numbered-index">{block.index}.</span>
                  {block.text}
                </p>
              )
            case 'metrics-group':
              return (
                <div key={i} className="weekly-report-doc__metrics-table-wrap">
                  <table className="weekly-report-doc__metrics-table">
                    <tbody>
                      {block.items.map((item, j) => (
                        <tr key={j}>
                          <th scope="row">{item.label}</th>
                          <td>{item.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            case 'spacer':
              return <div key={i} className="weekly-report-doc__spacer" aria-hidden />
            default:
              return (
                <p key={i} className="weekly-report-doc__paragraph">
                  {block.text}
                </p>
              )
          }
        })}
      </div>
    </article>
  )
}

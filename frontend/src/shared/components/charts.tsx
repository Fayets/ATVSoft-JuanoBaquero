'use client'

import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import type { Plugin } from 'chart.js'
import { Line, Doughnut, Bar, Pie } from 'react-chartjs-2'

// Plugin: per-segment colored glow for Doughnut/Pie charts
// Uses reduced blur to stay within canvas bounds
const doughnutGlowPlugin: Plugin = {
  id: 'doughnutGlow',
  beforeDraw(chart) {
    const chartType = (chart.config as { type?: string }).type
    if (chartType !== 'doughnut' && chartType !== 'pie') return
    const meta = chart.getDatasetMeta(0)
    if (!meta?.data?.length) return
    const ctx = chart.ctx
    ctx.save()
    for (const arc of meta.data) {
      const props = arc.getProps(['x', 'y', 'innerRadius', 'outerRadius', 'startAngle', 'endAngle'])
      const { x, y, startAngle, endAngle } = props
      const innerRadius = (props as Record<string, number>).innerRadius ?? 0
      const outerRadius = (props as Record<string, number>).outerRadius ?? 0
      if (!outerRadius) continue
      const bgColor = (arc.options as Record<string, unknown>).backgroundColor as string | undefined
      if (!bgColor || bgColor === '#1E1E22') continue
      // Single pass with moderate blur to avoid clipping
      ctx.save()
      ctx.shadowColor = bgColor
      ctx.shadowBlur = 14
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
      ctx.globalAlpha = 0.6
      ctx.beginPath()
      ctx.arc(x, y, (innerRadius + outerRadius) / 2, startAngle, endAngle)
      ctx.lineWidth = outerRadius - innerRadius
      ctx.strokeStyle = bgColor
      ctx.stroke()
      ctx.restore()
    }
    ctx.restore()
  },
}

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler, doughnutGlowPlugin)

// Polished defaults
ChartJS.defaults.plugins.legend.display = false
ChartJS.defaults.plugins.tooltip.enabled = true
ChartJS.defaults.color = '#A1A1AA'
ChartJS.defaults.borderColor = 'rgba(255,255,255,0.04)'
ChartJS.defaults.font.family = 'inherit'
// Set animation properties individually to avoid overwriting internal Chart.js animation callbacks
if (ChartJS.defaults.animation && typeof ChartJS.defaults.animation === 'object') {
  Object.assign(ChartJS.defaults.animation, { duration: 600, easing: 'easeOutQuart' })
} else {
  ChartJS.defaults.animation = { duration: 600, easing: 'easeOutQuart' }
}
ChartJS.defaults.elements.bar.borderRadius = 6
ChartJS.defaults.elements.line.borderCapStyle = 'round'
ChartJS.defaults.elements.line.borderJoinStyle = 'round'
// Add padding so glow doesn't clip at canvas edge
ChartJS.defaults.layout.padding = 16

export { Line, Doughnut, Bar, Pie }
export { ChartJS }

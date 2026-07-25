import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

export type AnalysisResult = {
  closer_report: string
  dolores_llamada: string
  razon_compra: string
  program_offered: string
  status: string
}

const ANALYSIS_PROMPT = `Sos un analista de ventas experto. Analizá la siguiente transcripción de una llamada de ventas entre un closer y un lead.

Los programas que se ofrecen son: "Boost", "Advantage", "Mentoria".
Los estados posibles del lead son: "Cerrado", "Seña", "Seguimiento", "No show", "Descalificado", "Pendiente".
Si el lead cerró, agregá el monto entre paréntesis. Ej: "Cerrado (1600usd)"

Extraé la siguiente información en español y generá la FICHA DE ANÁLISIS DE LLAMADA:

1. **REPORTE DEL CLOSER** (closer_report): Generá la ficha con EXACTAMENTE estas secciones, separadas por saltos de línea:

📋 FICHA DE ANÁLISIS DE LLAMADA\\n\\nFecha: [fecha de la llamada o "No mencionado"]\\nNombre del lead: [nombre completo]\\nEstado: [status con monto si cerró]\\n\\n¿Qué lo motivó a estar dentro de la llamada?:\\n[Contexto completo: por qué agendó, qué buscaba, cómo llegó]\\n\\n¿Cuál fue su mayor objeción o miedo? ¿Cómo la expresó? (Especificar literal lo que dijo si se puede):\\n[Objeción principal con citas textuales del lead entre comillas]\\n\\n¿Qué tipo de perfil tiene el lead?:\\n[Descripción del perfil profesional y nivel de experiencia]\\n\\nIngresos netos estimados del lead:\\n[Monto aproximado mensual en USD]\\n\\n¿Este lead representa al avatar ideal?:\\n[Sí/No con breve justificación si es necesario]\\n\\n¿Qué puedo aportar para marketing desde la llamada?:\\n[Lista de insights útiles para marketing, cada uno en nueva línea]\\n\\n¿Qué situación puntual está viviendo y qué le gustaría vivir en los próximos 3 meses?:\\nSituación actual: [descripción]\\nDeseo: [lo que quiere lograr]\\n\\n¿Cuáles fueron sus principales dolores? (Ser lo más específico posible):\\n[Lista de dolores, cada uno en nueva línea]\\n\\nDinero generado en la llamada:\\n[Monto comprometido/pagado o "No se generó dinero"]\\n\\nPrograma ofrecido al lead:\\n[Nombre del programa, duración, precio]

2. **DOLORES DE LA LLAMADA** (dolores_llamada): Los dolores extraídos de la ficha, cada uno con "• " al inicio y en línea separada.

3. **RAZÓN DE COMPRA** (razon_compra): Si cerró, por qué compró. Si no cerró, "No cerró" y el motivo.

4. **PROGRAMA OFRECIDO** (program_offered): Exactamente uno de: "Boost", "Advantage", "Mentoria", o "" si no se mencionó.

5. **STATUS** (status): Exactamente uno de: "Cerrado", "Seña", "Seguimiento", "Descalificado", "Pendiente".

Respondé EXACTAMENTE en este formato JSON (sin markdown, sin backticks):
{"closer_report": "...", "dolores_llamada": "...", "razon_compra": "...", "program_offered": "...", "status": "..."}

IMPORTANTE: En closer_report usá \\n para separar cada sección de la ficha. En dolores_llamada usá "• " y \\n para cada dolor. Incluí citas textuales del lead cuando sea posible.

TRANSCRIPCIÓN:
`

export async function analyzeTranscript(transcript: string): Promise<AnalysisResult> {
  // Truncar si es muy larga (max ~80k chars para dejar espacio al prompt)
  const truncated = transcript.length > 80000
    ? transcript.substring(0, 80000) + '\n\n[...transcripción truncada por longitud]'
    : transcript

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [
      { role: 'user', content: ANALYSIS_PROMPT + truncated }
    ],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''

  try {
    const parsed = JSON.parse(text)
    return {
      closer_report: parsed.closer_report || '',
      dolores_llamada: parsed.dolores_llamada || '',
      razon_compra: parsed.razon_compra || '',
      program_offered: parsed.program_offered || '',
      status: parsed.status || 'Pendiente',
    }
  } catch {
    return {
      closer_report: text,
      dolores_llamada: '',
      razon_compra: '',
      program_offered: '',
      status: 'Pendiente',
    }
  }
}

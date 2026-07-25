export type DailyCall = {
  id: number
  hora: string
  lead: string
  closer: string
  call_link: string
  status: string
  calificacion_llamada: '' | 'calificado' | 'descalificado'
  program_offered: string
  programada_ofrecido_llamada: string
  payment: number
  owed: number
}

export type ManualCallInput = {
  client_name: string
  closer: string
  hora: string
  ig_handle?: string
}

export type DailyCallsResponse = {
  fecha: string
  llamadas: DailyCall[]
}

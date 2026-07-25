'use client'

import Link from 'next/link'

const permissions = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
]

export default function InstagramTokenGuidePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="glass-card p-6">
        <h1 className="text-xl font-semibold tracking-tight text-white">Guía: Token de Instagram (larga duración)</h1>
        <p className="mt-2 text-sm text-[var(--text2)]">
          Seguí estos pasos para generar un token válido por 60 días y cargarlo en ATV MKT.
        </p>
      </div>

      <section className="glass-card p-6">
        <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">1</div>
        <h2 className="text-lg font-semibold text-white">Ir al Explorador de API Graph</h2>
        <div className="mt-3 space-y-2 text-sm text-[var(--text2)]">
          <p>
            Link directo:{' '}
            <a
              href="https://developers.facebook.com/tools/explorer"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              https://developers.facebook.com/tools/explorer
            </a>
          </p>
          <p>Seleccionar app <span className="font-semibold text-white">AVT MKT</span> en el dropdown "App de Meta".</p>
          <p>En "Usuario o página" seleccionar <span className="font-semibold text-white">Token del usuario</span>.</p>
        </div>
      </section>

      <section className="glass-card p-6">
        <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">2</div>
        <h2 className="text-lg font-semibold text-white">Agregar los permisos necesarios</h2>
        <p className="mt-3 text-sm text-[var(--text2)]">Marcá estos permisos antes de generar el token:</p>
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
          <ul className="space-y-2 text-sm text-white">
            {permissions.map((permission) => (
              <li key={permission} className="font-mono">
                - {permission}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-sm text-[var(--text2)]">Luego hacé clic en <span className="font-semibold text-white">Generate Access Token</span>.</p>
      </section>

      <section className="glass-card p-6">
        <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">3</div>
        <h2 className="text-lg font-semibold text-white">Convertir a token de larga duración (60 días)</h2>
        <div className="mt-3 space-y-2 text-sm text-[var(--text2)]">
          <p>Ir a Configuración básica de la app en Meta y copiar la Clave secreta.</p>
          <p>Abrir esta URL en el navegador (reemplazando los valores):</p>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4 text-xs text-white">
          <code>
            https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=979290131129376&client_secret=TU_CLAVE_SECRETA&fb_exchange_token=TOKEN_CORTO
          </code>
        </pre>
        <p className="mt-3 text-sm text-[var(--text2)]">Copiar el <span className="font-semibold text-white">access_token</span> del JSON que devuelve.</p>
      </section>

      <section className="glass-card p-6">
        <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">4</div>
        <h2 className="text-lg font-semibold text-white">Cargar el token en la app</h2>
        <ol className="mt-3 space-y-2 text-sm text-[var(--text2)]">
          <li>Volver a Conexiones API → Instagram.</li>
          <li>Pegar el token nuevo en <span className="font-semibold text-white">ACCESS TOKEN</span>.</li>
          <li>
            Confirmar que Instagram User ID sea <span className="font-mono text-white">17841400159563968</span>.
          </li>
          <li>Hacer clic en <span className="font-semibold text-white">GUARDAR</span>.</li>
        </ol>
      </section>

      <div className="pb-2">
        <Link
          href="/conexiones"
          className="inline-flex items-center rounded-lg border border-[var(--border2)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          ← Volver a Conexiones API
        </Link>
      </div>
    </div>
  )
}

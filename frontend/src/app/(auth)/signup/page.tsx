import { SignupForm } from '@/features/auth/components/signup-form'

export default function SignupPage() {
  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold tracking-tight text-[var(--text)]">
        Crear cuenta
      </h1>
      <p className="mb-6 text-sm text-[var(--text3)]">
        Empeza a trackear tu contenido y ventas
      </p>
      <SignupForm />
    </div>
  )
}

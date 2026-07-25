import Image from 'next/image'
import atvLogo from '@/assets/atv-logo.png'

type BrandLogoProps = {
  className?: string
}

/** Logo ATV (PNG importado) — evita depender solo de `/public` por si el asset no resuelve en dev/proxy. */
export function BrandLogo({
  className = 'h-10 w-auto max-w-[56px] flex-shrink-0 object-contain',
}: BrandLogoProps) {
  return (
    <Image
      src={atvLogo}
      alt="ATV"
      width={atvLogo.width}
      height={atvLogo.height}
      className={className}
      sizes="120px"
      priority
    />
  )
}

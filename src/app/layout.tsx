import './globals.css'
import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Planificateur de base', description: 'Planifie ta base avant de la construire.' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>
}

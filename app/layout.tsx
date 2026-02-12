export const metadata = {
  title: 'MemePet Agent',
  description: 'Bluesky autonomous bot agent for MemePet',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

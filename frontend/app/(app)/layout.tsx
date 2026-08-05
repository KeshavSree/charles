import Sidebar from '@/components/Sidebar'

// The main app shell: dark theme + sidebar.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: 'auto', padding: '16px' }}>{children}</main>
    </div>
  )
}

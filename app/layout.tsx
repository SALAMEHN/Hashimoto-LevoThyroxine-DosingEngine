export const metadata = {
    title: 'Thyroid Engine',
    description: 'MAP Bayesian Levothyroxine Titration System',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en">
            <body style={{ margin: 0, padding: 0, backgroundColor: '#030712', color: '#ffffff', fontFamily: 'system-ui, sans-serif' }}>
                {children}
            </body>
        </html>
    )
}
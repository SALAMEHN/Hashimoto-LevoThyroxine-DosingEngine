import './globals.css'

export const metadata = {
    title: 'Hashimoto L-Thyroxine Dosing Engine',
    description: 'MAP Bayesian Levothyroxine Titration System',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en">
            <body className="bg-gray-950 text-white min-h-screen">
                {children}
            </body>
        </html>
    )
}
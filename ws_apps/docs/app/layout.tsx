import './global.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';

const basePath = process.env['NEXT_PUBLIC_BASE_PATH'] ?? '';

export const metadata: Metadata = {
  title: {
    default: 'Harness App Template Docs',
    template: '%s | Harness App Template',
  },
  description: 'Documentation for the forkable agentic-engineering harness monorepo template.',
  icons: {
    icon: `${basePath}/favicon.svg`,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <RootProvider
          theme={{
            attribute: 'class',
            defaultTheme: 'system',
            enableSystem: true,
          }}
          search={{
            options: {
              type: 'static',
            },
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}

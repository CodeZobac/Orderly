import type { Metadata } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { WorkspaceLoader } from "@/components/workspace-loader";
import { WorkspaceProvider } from "@/components/workspace-provider";

const geistSans = localFont({
  src: "../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});
const geistMono = localFont({
  src: "../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Orderly · Freelance time",
  description: "A clear, private record of your freelance work.",
  icons: {
    icon: [16, 32, 48, 64, 128, 192, 256, 512].map((size) => ({
      url: `/favicon-set/favicon-${size}.png`,
      type: "image/png",
      sizes: `${size}x${size}`,
    })),
    apple: {
      url: "/favicon-set/favicon-180.png",
      type: "image/png",
      sizes: "180x180",
    },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense
          fallback={
            <main className="auth workspace-loading">
              <WorkspaceLoader />
            </main>
          }
        >
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </Suspense>
      </body>
    </html>
  );
}

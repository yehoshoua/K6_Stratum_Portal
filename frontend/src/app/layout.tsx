import type { Metadata } from "next";
import "./globals.css";
import LayoutWrapper from "@/components/LayoutWrapper";
import { PreferencesProvider } from "@/components/PreferencesContext";

const geistSans = { variable: "font-sans" };
const geistMono = { variable: "font-mono" };

export const metadata: Metadata = {
  title: "K6 Stratum Portal - Kubernetes & Performance Observability",
  description: "Advanced Kubernetes dashboard with K8s management, K6 operator CRD control and InfluxDB analytics.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PreferencesProvider>
          <LayoutWrapper>{children}</LayoutWrapper>
        </PreferencesProvider>
      </body>
    </html>
  );
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    let targetBase = process.env.BACKEND_URL || 'http://localhost:8080';
    
    if (request.nextUrl.pathname.startsWith('/api/reports/') || request.nextUrl.pathname === '/api/reports') {
      targetBase = process.env.REPORT_SERVICE_URL || 'http://localhost:8081';
    }

    // Construct the target URL on the correct service
    const targetUrl = new URL(
      request.nextUrl.pathname + request.nextUrl.search,
      targetBase
    );
    
    return NextResponse.rewrite(targetUrl);
  }
}

export const config = {
  matcher: '/api/:path*',
};

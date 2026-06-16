import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const targetBase = process.env.BACKEND_URL || 'http://localhost:8080';
    
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

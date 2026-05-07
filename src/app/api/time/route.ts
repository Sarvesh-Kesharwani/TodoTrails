export function GET() {
  return Response.json({ now: new Date().toISOString() });
}

// Greeting follows the operator's browser clock, not the API server's timezone.
export function dashboardGreeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

import CreditsErrorRedirector from "./CreditsErrorRedirector";

export default async function CreditsErrorPage({}: {
  searchParams: Promise<{ code?: string; message?: string }>;
}) {
  // The error handling is done in the client component
  // This allows us to access URL parameters easily
  return <CreditsErrorRedirector />;
}

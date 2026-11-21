import { notFound } from "next/navigation";
import { AppError } from "@/lib/errors";
import { getDatabase } from "@/server/database";
import { applicationOrigin } from "@/server/http";
import { GuestsStore } from "@/server/guests-store";
import { RsvpForm } from "@/components/rsvp-form";

export const dynamic = "force-dynamic";

export default async function RsvpPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  let view;
  try {
    applicationOrigin();
    view = await new GuestsStore(getDatabase()).view(token);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return <RsvpForm token={token} initial={view} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobLive } from "@/components/job/job-live";
import { getPublicJob, signedVideoUrl } from "@/server/jobs/public";
import { getViewer } from "@/server/session";

export const metadata: Metadata = { title: "Your montage" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const job = viewer && (await getPublicJob(id, viewer.id));
  if (!viewer || !job) notFound();

  // Rendered on the server from the DB, so the first frame needs no client fetch.
  const videoUrl = job.status === "succeeded" ? await signedVideoUrl(job.id, viewer.id).catch(() => null) : null;
  return <JobLive initial={job} initialVideoUrl={videoUrl} />;
}

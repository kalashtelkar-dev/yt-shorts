import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { notFound } from "next/navigation";
import { JobLive } from "@/components/job/job-live";
import { getPublicJob, signedVideo } from "@/server/jobs/public";
import { getViewer } from "@/server/session";

export const metadata: Metadata = { title: "Your montage", robots: { index: false, follow: false } };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const job = viewer && (await getPublicJob(id, viewer.id));
  if (!viewer || !job) notFound();

  // Rendered on the server from the DB, so the first frame needs no client fetch.
  const video = job.status === "succeeded" ? await signedVideo(job.id, viewer.id).catch(() => null) : null;
  return (
    <div className="flex flex-col gap-3">
      <BackLink href="/library">My videos</BackLink>
      <JobLive initial={job} initialVideo={video} />
    </div>
  );
}

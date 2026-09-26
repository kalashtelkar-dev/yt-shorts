import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/bits";
import { CatalogForm } from "@/components/admin/catalog-form";
import { requireAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: "New catalog item" };

export default async function NewCatalogItem() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="New catalog item" />
      <CatalogForm
        initial={{
          id: null,
          slug: "",
          title: "",
          description: "",
          templateId: "",
          enabled: false,
          beta: true,
          sortOrder: 10,
          durations: [30, 60, 90],
          prices: {},
          fields: [{ name: "playerName", label: "Your in-game name", type: "text", required: true, max: 32 }],
          inputMap: { youtubeUrl: "$source.url", playerName: "$fields.playerName" },
          stageMap: [{ match: "download", label: "Downloading your video" }],
          outputKey: "montage",
        }}
      />
    </>
  );
}
